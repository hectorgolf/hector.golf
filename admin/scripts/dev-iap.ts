/**
 * A stand-in for Identity-Aware Proxy, for a laptop.
 *
 * Deployed, this service sits behind IAP: a request arrives already
 * authenticated, carrying `x-goog-authenticated-user-email`, and the application
 * reads that header and nothing else. On a laptop there is no proxy, so there is
 * no header, so there is no viewer — every page renders as "not signed in" and
 * the sign-out link goes nowhere. That is correct, and it means the one flow the
 * admin cannot exercise locally is the one about who you are.
 *
 * This runs `astro dev` behind a small proxy that plays IAP's part: it asks who
 * you want to be, remembers it in a cookie, sets the header on every request it
 * forwards, and honours `gcp-iap-mode=CLEAR_LOGIN_COOKIE` by forgetting again.
 *
 *   npm run dev:iap                                        # two accounts, the defaults
 *   IAP_DEV_ACCOUNTS=solo@example.com npm run dev:iap      # just one
 *   PORT=5000 APP_PORT=5001 npm run dev:iap
 *
 * ## Why a proxy rather than a switch in the application
 *
 * `src/lib/identity.ts` says the header is IAP's and cannot be spoofed by a
 * caller. The cheap way to sign in locally — an environment variable the viewer
 * falls back to — would make that untrue: the one function whose job is to have
 * exactly one source of identity would have two, and the weaker one would be a
 * build flag away from production. Standing in front of the server instead
 * leaves the application unaware it is being lied to, which is the property
 * worth keeping.
 *
 * It is also the only way to exercise the *flow*. Signing out is a URL IAP reads
 * and this process never sees; nothing inside the application can act on it.
 *
 * ## What it is faithful about, and what it is not
 *
 * It sets both identity headers IAP sets, with the `accounts.google.com:` prefix
 * the real thing uses, and it strips those headers off incoming requests exactly
 * as IAP does — a caller cannot hand itself an identity through this any more
 * than through the real proxy.
 *
 * Configure two accounts and signing out lands you back on a chooser; configure
 * one and you are readmitted immediately. Those are the two behaviours IAP has
 * on the way back in, and the second one is the one that looks like a broken
 * button unless you have seen it.
 *
 * It does **not** issue `x-goog-iap-jwt-assertion`. Nothing verifies that today;
 * the day something does, this needs a keypair and a JWKS endpoint, and a fake
 * unsigned token in the meantime would only teach the verifier to accept one.
 *
 * ## Where it may run
 *
 * Development only, and it enforces that rather than trusting it: it refuses to
 * start under NODE_ENV=production and binds the loopback interface, so nothing
 * off the machine can reach an admin that hands out identities. It lives in
 * `scripts/` beside the seed and the export, none of which the container image
 * copies — the runtime stage takes `admin/dist` and nothing else.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** IAP prefixes both identity headers with the provider that authenticated you. */
const PROVIDER = 'accounts.google.com'

/** Where the chosen account is kept. Named for what it is, so it is never mistaken for IAP's own. */
export const COOKIE = 'dev_iap_user'

/** Under this prefix the stand-in answers for itself; everything else is proxied. */
export const SIGN_IN_PATH = '/_dev_iap/sign-in'

const DEFAULT_ACCOUNTS = 'admin@example.com,someone-else@example.com'

/**
 * Which accounts the chooser offers.
 *
 * Two by default, because one account is the case that hides the account
 * chooser: with a single identity to pick, signing out and coming back looks
 * like nothing happened, and a developer who has only ever seen that will read
 * the sign-out button as broken.
 */
export function accountsFrom(value: string | undefined): string[] {
    const accounts = (value ?? DEFAULT_ACCOUNTS)
        .split(',')
        .map((account) => account.trim())
        .filter((account) => account.length > 0)
    return accounts.length > 0 ? accounts : accountsFrom(undefined)
}

/** One cookie out of a Cookie header, or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
    for (const pair of (header ?? '').split(';')) {
        const separator = pair.indexOf('=')
        if (separator === -1) continue
        if (pair.slice(0, separator).trim() !== name) continue
        return decodeURIComponent(pair.slice(separator + 1).trim())
    }
    return undefined
}

/**
 * Where to go after signing in.
 *
 * Only a path on this server. A `continue` parameter is a redirect somebody else
 * can write, and while the audience here is one developer on one laptop, an open
 * redirect is not a thing to hand-wave through even in a toy: `//evil.example`
 * and `https://evil.example` both leave this origin, and both are what the check
 * is for.
 */
export function safeContinue(value: string | null | undefined): string {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
    return value
}

/**
 * The headers IAP would have set.
 *
 * The id is derived from the address rather than random so that it is stable
 * across restarts, the way a real subject id is. It is not a Google subject id
 * and is not meant to pass for one; nothing reads it today.
 */
export function identityHeaders(email: string): Record<string, string> {
    const digest = createHash('sha256').update(email).digest('hex').slice(0, 15)
    return {
        'x-goog-authenticated-user-email': `${PROVIDER}:${email}`,
        'x-goog-authenticated-user-id': `${PROVIDER}:${BigInt(`0x${digest}`)}`,
    }
}

/**
 * Incoming identity headers, removed.
 *
 * IAP overwrites these on every request, which is exactly why the application is
 * allowed to trust them. A stand-in that let a caller's own header through would
 * be teaching the opposite lesson: `curl -H 'x-goog-authenticated-user-email: …'`
 * has to be as useless here as it is in production.
 */
export function withoutSpoofedIdentity(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const kept: IncomingHttpHeaders = {}
    for (const [name, value] of Object.entries(headers)) {
        const lowered = name.toLowerCase()
        if (lowered.startsWith('x-goog-authenticated-user') || lowered.startsWith('x-goog-iap')) continue
        kept[name] = value
    }
    return kept
}

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * The chooser.
 *
 * Deliberately plain, and deliberately not built from the admin's stylesheet: a
 * page that says "nothing here is authentication" should not look like part of
 * the product.
 */
function chooserPage(accounts: string[], continueTo: string): string {
    const links = accounts
        .map((account) => {
            const href = `${SIGN_IN_PATH}?account=${encodeURIComponent(account)}&continue=${encodeURIComponent(continueTo)}`
            return `<li><a href="${escapeHtml(href)}">${escapeHtml(account)}</a></li>`
        })
        .join('\n      ')

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in · local IAP stand-in</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #111; color: #eee; font: 15px/1.5 system-ui, sans-serif; }
    main { width: min(28rem, calc(100vw - 3rem)); border: 1px solid #333;
           border-radius: 12px; padding: 1.5rem; background: #191919; }
    h1 { margin: 0 0 0.25rem; font-size: 1.1rem; }
    p { margin: 0 0 1rem; color: #999; font-size: 0.85rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
    a { display: block; padding: 0.6rem 0.8rem; border: 1px solid #444;
        border-radius: 8px; color: #eee; text-decoration: none; }
    a:hover { background: #222; }
  </style>
</head>
<body>
  <main>
    <h1>Choose an account</h1>
    <p>
      A local stand-in for Identity-Aware Proxy. It authenticates nobody: picking a name
      here only sets the header IAP would have set. It runs on this machine and only for
      <code>npm run dev:iap</code>.
    </p>
    <ul>
      ${links}
    </ul>
  </main>
</body>
</html>
`
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
    res.writeHead(302, { location, ...(cookie ? { 'set-cookie': cookie } : {}) })
    res.end()
}

/** Waits for `astro dev` to start listening, so the first request does not race it. */
async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const open = await new Promise<boolean>((resolve) => {
            const socket = net.connect({ port, host: '127.0.0.1' })
            socket.once('connect', () => { socket.destroy(); resolve(true) })
            socket.once('error', () => { socket.destroy(); resolve(false) })
        })
        if (open) return
        if (Date.now() > deadline) throw new Error(`astro dev did not start on port ${port} within ${timeoutMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, 150))
    }
}

/**
 * Astro's own binary, run directly rather than through `npm run dev`.
 *
 * An npm in between is a second process to kill, and the one that gets missed:
 * Ctrl-C would leave a dev server holding the port with nothing left to stop it.
 */
function astroBinary(adminDir: string): string {
    const candidates = [
        join(adminDir, 'node_modules/.bin/astro'),
        join(adminDir, '../node_modules/.bin/astro'),
    ]
    return candidates.find((candidate) => existsSync(candidate)) ?? 'astro'
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        console.error('dev-iap is a development tool and refuses to run with NODE_ENV=production.')
        process.exit(1)
    }

    const port = Number(process.env.PORT ?? 4321)
    const appPort = Number(process.env.APP_PORT ?? 4322)
    const accounts = accountsFrom(process.env.IAP_DEV_ACCOUNTS)
    const adminDir = join(dirname(fileURLToPath(import.meta.url)), '..')

    const astro: ChildProcess = spawn(
        astroBinary(adminDir),
        ['dev', '--port', String(appPort), '--host', '127.0.0.1'],
        { cwd: adminDir, stdio: ['ignore', 'inherit', 'inherit'] }
    )
    astro.on('exit', (code) => {
        console.error(`astro dev exited (${code ?? 'signal'}); stopping the stand-in too.`)
        process.exit(code ?? 1)
    })

    const proxy = (req: IncomingMessage, res: ServerResponse, email: string): void => {
        const headers = {
            ...withoutSpoofedIdentity(req.headers),
            ...identityHeaders(email),
            host: `127.0.0.1:${appPort}`,
        }
        const upstream = http.request(
            { host: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers },
            (response) => {
                res.writeHead(response.statusCode ?? 502, response.headers)
                response.pipe(res)
            }
        )
        upstream.on('error', (error) => {
            res.writeHead(502, { 'content-type': 'text/plain' })
            res.end(`The dev server did not answer: ${error.message}`)
        })
        req.pipe(upstream)
    }

    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

        // IAP reads this parameter and the app never sees it; so does this.
        if (url.searchParams.get('gcp-iap-mode') === 'CLEAR_LOGIN_COOKIE') {
            return redirect(res, '/', `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`)
        }

        if (url.pathname === SIGN_IN_PATH) {
            const account = url.searchParams.get('account') ?? ''
            if (!accounts.includes(account)) return redirect(res, '/')
            const cookie = `${COOKIE}=${encodeURIComponent(account)}; Path=/; SameSite=Lax; HttpOnly`
            return redirect(res, safeContinue(url.searchParams.get('continue')), cookie)
        }

        const email = readCookie(req.headers.cookie, COOKIE)
        // An account dropped from the list stops being a session, rather than
        // living on in a cookie nothing offers any more.
        if (!email || !accounts.includes(email)) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            return void res.end(chooserPage(accounts, url.pathname + url.search))
        }

        proxy(req, res, email)
    })

    // Astro's hot reload is a websocket, and a proxy that only forwards requests
    // leaves the browser reconnecting forever while edits never arrive.
    server.on('upgrade', (req, socket, head) => {
        const email = readCookie(req.headers.cookie, COOKIE)
        if (!email || !accounts.includes(email)) return socket.destroy()

        const upstream = http.request({
            host: '127.0.0.1',
            port: appPort,
            path: req.url,
            method: req.method,
            headers: { ...withoutSpoofedIdentity(req.headers), ...identityHeaders(email) },
        })
        upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
            const lines = Object.entries(response.headers).map(([name, value]) => `${name}: ${value}`)
            socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
            if (upstreamHead.length > 0) socket.unshift(upstreamHead)
            upstreamSocket.pipe(socket).pipe(upstreamSocket)
        })
        upstream.on('error', () => socket.destroy())
        if (head.length > 0) upstream.write(head)
        upstream.end()
    })

    const stop = (): void => {
        astro.kill('SIGTERM')
        server.close(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)

    await waitForPort(appPort)
    server.listen(port, '127.0.0.1', () => {
        console.log(`\nIAP stand-in on http://localhost:${port} — astro dev behind it on ${appPort}`)
        console.log(`Accounts: ${accounts.join(', ')}`)
        console.log('Sign out from the admin itself; it clears the cookie and asks again.\n')
    })
}

// Importable for its parts without starting anything, which is what the tests do.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main()
}
