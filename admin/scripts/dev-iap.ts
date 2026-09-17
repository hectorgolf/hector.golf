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
 * This runs Astro's dev server behind a small proxy that plays IAP's part: it
 * asks who you want to be, remembers it in a cookie, sets the header on every
 * request it forwards, and honours `gcp-iap-mode=CLEAR_LOGIN_COOKIE` by
 * forgetting again.
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
 * It sets the identity headers IAP sets, with the `accounts.google.com:` prefix
 * the real thing uses, and it strips those headers off incoming requests exactly
 * as IAP does — a caller cannot hand itself an identity through this any more
 * than through the real proxy.
 *
 * Configure two accounts and signing out lands you back on a chooser; configure
 * one and you are readmitted immediately. Those are the two behaviours IAP has
 * on the way back in, and the second one is the one that looks like a broken
 * button unless you have seen it.
 *
 * It sets `x-goog-iap-jwt-assertion` to a sentence rather than a token. Omitting
 * it would have been the cautious-looking choice and is the worse one: a request
 * that carries the header in production and not locally is a difference a future
 * verifier meets as "header missing", and the tempting local fix for that is to
 * stop requiring it. Presence is therefore faithful and only the value is not —
 * and the value cannot be mistaken for one, since it does not parse as a JWT in
 * any library and says in plain English what it is and where it came from. A
 * verifier that meets it fails with that sentence in the error, which is a
 * better first clue than "invalid signature".
 *
 * What it deliberately is not is a *signed* token. A fake one that verified
 * would teach the verifier to accept fakes; the day a real assertion is needed
 * locally, this needs a keypair and a JWKS endpoint, and that is the honest cost.
 *
 * ## Why the dev server runs in this process
 *
 * `dev()` — Astro's programmatic API — starts the same server the CLI does, in
 * the caller's process, and hands back an object with `stop()` on it. This calls
 * that instead of spawning `astro dev`, and the reason is what happened when it
 * did spawn it.
 *
 * Astro 7.3 daemonises the dev server *on its own*, with no `--background`, when
 * `am-i-vibing` recognises an AI coding agent around the CLI. A stand-in can
 * only proxy to a server it supervises, so the spawned process exited at once,
 * this one followed it down, and `npm run dev:iap` was over a second after it
 * started — for exactly the people who run this repository from an agent, and
 * for nobody else. Two undocumented levers fixed it: `ASTRO_DEV_BACKGROUND`,
 * whose name means the opposite of the use it was put to, and `--ignore-lock`.
 *
 * The class of problem is the point. Spawning a CLI means inheriting every
 * decision that CLI makes about process lifetime, and those decisions are not
 * part of any API — backgrounding, lock files and agent detection all live in
 * `astro/dist/cli/dev/index.js` and none of them are reachable from `dev()`,
 * which is a function that returns a server and makes no decisions about
 * processes at all. It is marked experimental, and that is a real cost; weigh it
 * against the fact that it was the stable, documented CLI that changed its
 * process model under this script without notice.
 *
 * It also removes the orphan case. There is no child to outlive a hard kill of
 * this process holding the port, because the dev server *is* this process. The
 * other side of that trade is that a crash here takes the dev server with it,
 * which was already true in the direction that mattered.
 *
 * ## Where it may run
 *
 * Development only, and it enforces that rather than trusting it: it refuses to
 * start under NODE_ENV=production and binds the loopback interface, so nothing
 * off the machine can reach an admin that hands out identities. It lives in
 * `scripts/` beside the seed and the export, none of which the container image
 * copies — the runtime stage takes `admin/dist` and nothing else.
 */
import { createHash } from 'node:crypto'
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { dev } from 'astro'

/** IAP prefixes both identity headers with the provider that authenticated you. */
const PROVIDER = 'accounts.google.com'

/** Where the chosen account is kept. Named for what it is, so it is never mistaken for IAP's own. */
export const COOKIE = 'dev_iap_user'

/**
 * What goes in `x-goog-iap-jwt-assertion` instead of a token.
 *
 * Not a JWT and not shaped like one: no dots, no base64url, nothing any library
 * will take apart and nothing that can be made to verify. What it is instead is
 * legible — a verifier that meets it reports this sentence, which says both what
 * happened and which file to go and read.
 */
export const JWT_ASSERTION_STAND_IN = '<OMITTED WHEN RUNNING LOCALLY - dev-iap stand-in, not a JWT>'

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
    if (!value) return '/'
    try {
        const base = 'http://localhost'
        const parsed = new URL(value, base)
        if (parsed.origin !== base) return '/'
        if (!value.startsWith('/')) return '/'
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
        return '/'
    }
}

/**
 * The headers IAP would have set.
 *
 * The id is derived from the address rather than random so that it is stable
 * across restarts, the way a real subject id is. It is not a Google subject id
 * and is not meant to pass for one; nothing reads it today.
 *
 * All three headers IAP sets are here, the assertion included — see
 * `JWT_ASSERTION_STAND_IN` for why it carries a sentence rather than a token.
 */
export function identityHeaders(email: string): Record<string, string> {
    const digest = createHash('sha256').update(email).digest('hex').slice(0, 15)
    return {
        'x-goog-authenticated-user-email': `${PROVIDER}:${email}`,
        'x-goog-authenticated-user-id': `${PROVIDER}:${BigInt(`0x${digest}`)}`,
        'x-goog-iap-jwt-assertion': JWT_ASSERTION_STAND_IN,
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

/**
 * The headers to forward upstream: the caller's own, with any identity it tried
 * to supply replaced by the one it signed in as.
 *
 * `host` is deliberately left as the browser sent it. Pointing it at the dev
 * server's own address is the obvious thing to do and it breaks every form in
 * the admin: Astro reconstructs the request URL from `Host` and compares it to
 * the browser's `Origin` header, so a rewritten host makes every POST look
 * cross-site and returns "Cross-site POST form submissions are forbidden" — the
 * same failure `security.allowedDomains` exists to fix in production. A real
 * proxy passes the host through, and so does this. Where to send the bytes is
 * settled by the socket, not by the header.
 */
export function forwardedHeaders(headers: IncomingHttpHeaders, email: string): IncomingHttpHeaders {
    return { ...withoutSpoofedIdentity(headers), ...identityHeaders(email) }
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


/**
 * The 101 to send the browser, rebuilt from the one upstream sent.
 *
 * From `rawHeaders` rather than `headers`, which is a parsed object: it lowercases
 * names, and it collapses a repeated header into one comma-joined value. Neither
 * matters for the three headers a websocket handshake carries today, and both are
 * the kind of lossy that is discovered years later by something that did care.
 */
export function handshakeResponse(rawHeaders: readonly string[]): string {
    const lines: string[] = []
    for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
        lines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`)
    }
    return `HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`
}

/**
 * Join the two upgraded sockets, leftovers and all.
 *
 * The leftovers are the whole of the difficulty, and the reason this is a named
 * function with a test rather than four lines inside the handler.
 *
 * Both sides can arrive with bytes that were read *past* the handshake, because
 * TCP does not preserve anybody's idea of where a message ends: if the peer's
 * first websocket frame shares a segment with the last byte of the handshake,
 * the HTTP parser hands that frame over as a `head` buffer instead of leaving it
 * on the socket. Each one therefore has exactly one correct destination, and it
 * is the *other* socket:
 *
 *     upstreamHead  are bytes the dev server sent  → write to the browser
 *     clientHead    are bytes the browser sent     → write to the dev server
 *
 * Getting that backwards does not fail cleanly. Pushing `upstreamHead` back onto
 * the browser socket's *readable* side — which is what `unshift` does — means the
 * pipe below promptly delivers the dev server's own frame back to the dev server,
 * as though the browser had sent it. And since a server's frames are unmasked
 * while a client's must be masked, `ws` rejects it with
 *
 *     RangeError: Invalid WebSocket frame: MASK must be set
 *
 * which names neither the proxy nor the direction, and appears only when the
 * race lands — which is to say occasionally, on one page load in a few, with the
 * frame that was bounced also never reaching the browser.
 */
export function joinUpgradedSockets(
    client: Duplex,
    upstream: Duplex,
    clientHead: Buffer,
    upstreamHead: Buffer
): void {
    if (upstreamHead.length > 0) client.write(upstreamHead)
    if (clientHead.length > 0) upstream.write(clientHead)
    upstream.pipe(client)
    client.pipe(upstream)
}

/**
 * Everything in front of the dev server, and nothing about starting one.
 *
 * A function rather than four dozen lines inside `main` so that the tests can
 * put a stub upstream behind it and drive the whole path over a real socket —
 * the chooser, the cookie, the forwarded headers, the upgrade. Which port it
 * forwards to is a parameter for the same reason `main` passes
 * `astro.address.port` rather than `APP_PORT`: where the dev server ended up
 * listening is the dev server's answer to give, not this file's to assume.
 */
export function createStandIn({
    accounts,
    upstreamPort,
}: {
    accounts: string[]
    upstreamPort: number
}): http.Server {
    const proxy = (req: IncomingMessage, res: ServerResponse, email: string): void => {
        const upstream = http.request(
            {
                host: '127.0.0.1',
                port: upstreamPort,
                path: req.url,
                method: req.method,
                headers: forwardedHeaders(req.headers, email),
            },
            (response) => {
                res.writeHead(response.statusCode ?? 502, response.headers)
                // A dev server that goes away *mid*-response reports it here,
                // on the response, and not on the request — and `pipe` does not
                // carry an error across. Without this the browser sits out a
                // content-length that is never going to arrive, which is what a
                // config file saved under an open request used to look like.
                response.on('error', () => res.destroy())
                response.pipe(res)
            }
        )
        upstream.on('error', (error) => {
            // There is no status line left to replace once one has been sent,
            // and `writeHead` throws rather than saying so.
            if (res.headersSent) return void res.destroy()
            res.writeHead(502, { 'content-type': 'text/plain' })
            res.end(`The dev server did not answer: ${error.message}`)
        })
        req.pipe(upstream)
    }

    const server = http.createServer((req, res) => {
        // A base only because `new URL` will not parse a path without one. None
        // of it is forwarded: the proxy sends `req.url` as it arrived and leaves
        // the browser's own `host` header alone.
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')

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
    // leaves the browser reconnecting forever while edits never arrive. The
    // socket belongs to the dev server's own HTTP listener and `DevServer`
    // exposes nothing for `upgrade`, which is why the second port stays even
    // though the server is now in this process.
    server.on('upgrade', (req, socket, head) => {
        // Node removes its own `error` listener from a socket when it emits
        // `upgrade`, so from here on an ECONNRESET — a tab closed during the
        // handshake, a dev server restarted under an open hot-reload socket —
        // is an unhandled `error` event, which is to say an uncaught exception.
        socket.on('error', () => socket.destroy())

        const email = readCookie(req.headers.cookie, COOKIE)
        if (!email || !accounts.includes(email)) return socket.destroy()

        const upstream = http.request({
            host: '127.0.0.1',
            port: upstreamPort,
            path: req.url,
            method: req.method,
            headers: forwardedHeaders(req.headers, email),
        })
        upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
            // The same again for the other end: `upstream`'s own `error`
            // handler below stops covering this socket once it is upgraded.
            upstreamSocket.on('error', () => upstreamSocket.destroy())
            socket.write(handshakeResponse(response.rawHeaders))
            joinUpgradedSockets(socket, upstreamSocket, head, upstreamHead)
        })
        upstream.on('error', () => socket.destroy())
        // `head` is forwarded above, on the upgraded socket. Writing it here
        // instead would put the browser's first frame in the *request body*,
        // chunk-framed and ahead of the 101, which corrupts the stream in a
        // second way.
        upstream.end()
    })

    return server
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

    // Resolves once the server is listening, so there is nothing to race and no
    // port to poll; a server that fails to start rejects here instead of exiting
    // somewhere else and leaving this to interpret a status code. Ctrl-C before
    // this returns takes the default handler, which is the right one — there is
    // no child left behind to hold the port.
    const astro = await dev({ root: adminDir, server: { port: appPort, host: '127.0.0.1' } })

    // Not `appPort`: with `strictPort` off, Vite moves to the next free port
    // when that one is taken, and the proxy has to follow it.
    const server = createStandIn({ accounts, upstreamPort: astro.address.port })

    /**
     * One way out, however it was reached.
     *
     * Guarded, because both routes into it can happen at once: under
     * `npm run dev:fake` Ctrl-C signals this process directly *and* the parent
     * sends SIGTERM, and stopping twice means two `process.exit`es racing a
     * half-closed dev server.
     *
     * Nothing waits for `server.close()`, and that is deliberate. It waits for
     * open sockets to end on their own; `closeAllConnections()` deals with the
     * ordinary keep-alives, but Node stops counting a socket as one of the
     * server's the moment it is upgraded, so the hot-reload websocket is beyond
     * even its reach and the callback would never fire. Ctrl-C would then read
     * as having done nothing at all. Shutdown hangs off the dev server's own
     * `stop()` instead, which is the half with cleanup worth waiting for, and
     * the exit is explicit rather than left to an emptied event loop — Vite
     * keeps a readline interface on stdin for its keyboard shortcuts.
     *
     * And on a deadline, because the exit is now the only thing the person
     * pressing Ctrl-C is waiting for and `stop()` is somebody else's code. It
     * takes a few tens of milliseconds in practice; if it ever does not, an
     * unresponsive Ctrl-C is the worse of the two outcomes.
     */
    const SHUTDOWN_DEADLINE_MS = 3_000
    let stopping = false
    const stop = (code: number): void => {
        if (stopping) return
        stopping = true

        server.closeAllConnections()
        server.close()
        setTimeout(() => {
            console.error(`the dev server did not stop within ${SHUTDOWN_DEADLINE_MS}ms; exiting anyway.`)
            process.exit(code)
        }, SHUTDOWN_DEADLINE_MS)
        void astro
            .stop()
            .catch((error: unknown) => console.error(`the dev server did not stop cleanly: ${String(error)}`))
            .finally(() => process.exit(code))
    }
    process.on('SIGINT', () => stop(0))
    process.on('SIGTERM', () => stop(0))

    // The dev server is in this process now, so it goes down with the stand-in
    // either way. Saying so, and going through `stop`, is the difference between
    // one sentence and a stack trace under twenty lines of Astro's startup — and
    // it gives `astro.stop()` the chance to run, which an uncaught exception does
    // not.
    server.on('error', (error) => {
        console.error(`the IAP stand-in on port ${port} failed: ${error.message}`)
        stop(1)
    })

    server.listen(port, '127.0.0.1', () => {
        console.log(
            `\nIAP stand-in on http://localhost:${port} — the dev server, in this process, on ${astro.address.port}`
        )
        console.log(`Accounts configured: ${accounts.length}`)
        console.log('Sign out from the admin itself; it clears the cookie and asks again.\n')
    })
}

// Importable for its parts without starting anything, which is what the tests do.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main()
}
