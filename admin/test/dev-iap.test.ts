import http, { type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Duplex } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { viewerFromHeaders } from '../src/lib/identity.ts'
import {
    accountsFrom,
    COOKIE,
    createStandIn,
    handshakeResponse,
    joinUpgradedSockets,
    forwardedHeaders,
    identityHeaders,
    JWT_ASSERTION_STAND_IN,
    readCookie,
    safeContinue,
    SIGN_IN_PATH,
    withoutSpoofedIdentity,
} from '../scripts/dev-iap.ts'

/**
 * The stand-in is a development tool, and most of it is plumbing that only a
 * browser can judge. These are the parts where being wrong is quiet: a header
 * the application cannot read, a spoof the stand-in lets through, a redirect
 * that leaves the origin.
 */
describe('the headers the stand-in sets', () => {
    it('are the ones the application actually reads, prefix and all', () => {
        const headers = identityHeaders('someone@example.com')
        const viewer = viewerFromHeaders(new Headers(headers))

        // The point of the test: round-tripped through the real parser, not
        // compared against a string this file also wrote.
        expect(viewer).toEqual({ email: 'someone@example.com', authenticated: true })
        expect(headers['x-goog-authenticated-user-id']).toMatch(/^accounts\.google\.com:\d+$/)
    })

    /**
     * The assertion is present because production's requests carry it, and a
     * verifier written later should meet the same shape of request locally as it
     * will in the cloud — "header missing" is a difference whose tempting local
     * fix is to stop requiring the header at all. The value is the part that
     * cannot be faithful, so it is made unmistakable instead.
     */
    it('carry a JWT assertion that no library could take for a token', () => {
        const assertion = identityHeaders('someone@example.com')['x-goog-iap-jwt-assertion']

        expect(assertion).toBe(JWT_ASSERTION_STAND_IN)
        // Three dot-separated base64url segments is the whole of a JWT's shape.
        expect(assertion).not.toMatch(/^[\w-]+\.[\w-]+\.[\w-]*$/)
        expect(assertion).toContain('not a JWT')
        // Legal in a header value, which is the one way this could fail at runtime.
        expect(() => new Headers(identityHeaders('someone@example.com'))).not.toThrow()
    })

    it('give an account the same id every time, the way a subject id is stable', () => {
        expect(identityHeaders('a@example.com')).toEqual(identityHeaders('a@example.com'))
        expect(identityHeaders('a@example.com')['x-goog-authenticated-user-id']).not.toBe(
            identityHeaders('b@example.com')['x-goog-authenticated-user-id']
        )
    })
})

/**
 * IAP overwrites these headers on every request, which is the reason the
 * application may trust them. A stand-in that forwarded a caller's own would
 * teach the opposite lesson in the place developers form their intuition.
 */
describe('an identity a caller tries to hand itself', () => {
    it('does not survive the proxy', () => {
        const kept = withoutSpoofedIdentity({
            'x-goog-authenticated-user-email': 'accounts.google.com:intruder@example.com',
            'x-goog-authenticated-user-id': 'accounts.google.com:1',
            'x-goog-iap-jwt-assertion': 'nonsense',
            'user-agent': 'curl/8',
        })

        expect(kept).toEqual({ 'user-agent': 'curl/8' })
    })

    it('is stripped whatever case it was sent in', () => {
        expect(withoutSpoofedIdentity({ 'X-Goog-Authenticated-User-Email': 'x' } as never)).toEqual({})
    })
})

/**
 * The host header is the one piece of a forwarded request that must NOT be
 * helpfully corrected. Astro rebuilds the request URL from it and compares that
 * to the browser's Origin, so pointing it at the dev server turns every form
 * POST into "Cross-site POST form submissions are forbidden" — the same failure
 * `security.allowedDomains` fixes in production, reintroduced by the proxy.
 */
describe('what reaches the dev server', () => {
    it('keeps the host the browser asked for', () => {
        const forwarded = forwardedHeaders(
            { host: 'localhost:4321', 'user-agent': 'firefox' },
            'someone@example.com'
        )

        expect(forwarded.host).toBe('localhost:4321')
        expect(forwarded['user-agent']).toBe('firefox')
    })

    it('replaces an identity the caller supplied with the one it signed in as', () => {
        const forwarded = forwardedHeaders(
            {
                host: 'localhost:4321',
                'x-goog-authenticated-user-email': 'accounts.google.com:intruder@example.com',
            },
            'someone@example.com'
        )

        expect(forwarded['x-goog-authenticated-user-email']).toBe(
            'accounts.google.com:someone@example.com'
        )
    })
})

describe('where signing in sends you afterwards', () => {
    it('keeps a local path, so you land back where you were', () => {
        expect(safeContinue('/events/matchplay?saved=details')).toBe('/events/matchplay?saved=details')
    })

    it('refuses anything that leaves this origin', () => {
        expect(safeContinue('//evil.example/')).toBe('/')
        expect(safeContinue('https://evil.example/')).toBe('/')
        expect(safeContinue(null)).toBe('/')
        expect(safeContinue('')).toBe('/')
    })
})

describe('the accounts on offer', () => {
    it('are whatever was configured, trimmed', () => {
        expect(accountsFrom(' one@example.com , two@example.com ')).toEqual([
            'one@example.com',
            'two@example.com',
        ])
    })

    it('default to two, because one account hides the chooser entirely', () => {
        expect(accountsFrom(undefined).length).toBe(2)
        expect(accountsFrom('   ').length).toBe(2)
    })
})

describe('reading the cookie back', () => {
    it('finds its own among others, and decodes the address', () => {
        const header = 'other=1; dev_iap_user=someone%40example.com; another=2'
        expect(readCookie(header, 'dev_iap_user')).toBe('someone@example.com')
    })

    it('is undefined when there is none, rather than empty', () => {
        expect(readCookie('other=1', 'dev_iap_user')).toBeUndefined()
        expect(readCookie(undefined, 'dev_iap_user')).toBeUndefined()
    })
})

/**
 * One end of the proxy, as a stream that remembers what was written to it and
 * lets the test decide what it has to say.
 */
function socketDouble() {
    const written: Buffer[] = []
    const duplex = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
            written.push(Buffer.from(chunk))
            callback()
        },
    })
    return { duplex, text: () => Buffer.concat(written).toString('utf-8') }
}

/**
 * The hot-reload websocket, and the bug that took a while to place because the
 * error names nothing involved in it.
 *
 * TCP does not preserve anybody's idea of where a message ends, so either peer's
 * first websocket frame can share a segment with the last byte of the handshake
 * — and then Node's HTTP parser hands that frame over as a `head` buffer rather
 * than leaving it on the socket. Each leftover has exactly one correct
 * destination, and it is the *other* socket.
 *
 * Sent the wrong way, the dev server receives its own frame back as though the
 * browser had sent it. A server's frames are unmasked and a client's must be
 * masked, so `ws` rejects it with `RangeError: Invalid WebSocket frame: MASK
 * must be set` — an error that mentions neither the proxy nor the direction, and
 * that appears only when the race lands.
 */
describe('joining the two ends of an upgraded websocket', () => {
    it("gives the dev server's leftover bytes to the browser, and not back to the dev server", () => {
        const client = socketDouble()
        const upstream = socketDouble()

        // An unmasked frame, which is what a server sends and what a server
        // refuses to receive.
        const fromServer = Buffer.from([0x81, 0x03, 0x68, 0x69])
        joinUpgradedSockets(client.duplex, upstream.duplex, Buffer.alloc(0), fromServer)

        expect(client.text()).toContain('hi')
        // The bug, stated as the thing that must not happen: bounced back, this
        // is the unmasked frame `ws` rejects.
        expect(upstream.text()).toBe('')
    })

    it("gives the browser's leftover bytes to the dev server", () => {
        const client = socketDouble()
        const upstream = socketDouble()

        joinUpgradedSockets(client.duplex, upstream.duplex, Buffer.from('masked-frame'), Buffer.alloc(0))

        expect(upstream.text()).toContain('masked-frame')
        expect(client.text()).toBe('')
    })

    it('carries on forwarding both ways once the leftovers are out of the way', async () => {
        const client = socketDouble()
        const upstream = socketDouble()
        joinUpgradedSockets(client.duplex, upstream.duplex, Buffer.alloc(0), Buffer.alloc(0))

        client.duplex.push('from the browser')
        upstream.duplex.push('from the dev server')
        await new Promise((resolve) => setImmediate(resolve))

        expect(upstream.text()).toBe('from the browser')
        expect(client.text()).toBe('from the dev server')
    })
})

describe('the handshake sent back to the browser', () => {
    it('is built from the raw headers, so nothing is lowercased or collapsed', () => {
        const response = handshakeResponse([
            'Upgrade',
            'websocket',
            'Connection',
            'Upgrade',
            'Sec-WebSocket-Accept',
            's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        ])

        expect(response.startsWith('HTTP/1.1 101 Switching Protocols\r\n')).toBe(true)
        // Casing preserved: `rawHeaders` is the reason to use it over `headers`.
        expect(response).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
        expect(response.endsWith('\r\n\r\n')).toBe(true)
    })

    it('keeps a repeated header repeated rather than comma-joining it', () => {
        const response = handshakeResponse(['X-Thing', 'one', 'X-Thing', 'two'])
        expect(response).toContain('X-Thing: one\r\nX-Thing: two')
    })
})

/**
 * The stand-in, over real sockets, with a stub where the dev server goes.
 *
 * Everything above this point tests a pure function, which leaves the part that
 * actually runs — routing, the cookie, the proxy hop, the upgrade — covered only
 * by opening a browser. That gap was affordable while the tests also pinned the
 * CLI's process model; now that nothing is spawned, this is what is left to get
 * wrong, and all of it is reachable from a socket.
 *
 * The questions are all of the form "what arrived upstream", so the upstream is
 * what answers them: it replies with the request it was given, and the test
 * reads that rather than reaching inside the proxy.
 */
const ACCOUNTS = ['first@example.com', 'second@example.com']

type SeenRequest = { method: string; url: string; headers: IncomingHttpHeaders; body: string }

function upstreamDouble(): http.Server {
    const server = http.createServer((req, res) => {
        // A dev server that starts answering and then goes away — a restart
        // under an open request. The headers are already the browser's by then,
        // so there is no 502 left to send.
        if (req.url === '/die-mid-answer') {
            res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' })
            // Flushed and given a tick to reach the browser, so the test is
            // about a reset *after* the headers rather than a race with them.
            res.write('the first half', () => setTimeout(() => res.socket?.destroy(), 50))
            return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
            // A header of its own, so a test can tell an answer from upstream
            // apart from one the stand-in wrote itself.
            res.writeHead(200, { 'content-type': 'application/json', 'x-from': 'upstream' })
            const seen: SeenRequest = {
                method: req.method ?? '',
                url: req.url ?? '',
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf-8'),
            }
            res.end(JSON.stringify(seen))
        })
    })

    // Astro's hot reload, in miniature: a handshake carrying a header whose
    // casing must survive the stand-in, and then an echo, so both directions of
    // the joined socket can be observed.
    server.on('upgrade', (req, socket) => {
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `X-Saw-Email: ${String(req.headers['x-goog-authenticated-user-email'])}\r\n` +
                '\r\n'
        )
        // A dev server that dies rather than closing: an RST, not a FIN.
        if (req.url === '/reset-after-handshake') {
            setTimeout(() => (socket as Socket).resetAndDestroy(), 50)
            return
        }
        socket.on('data', (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])))
    })

    return server
}

const opened: { server: http.Server; sockets: Set<Duplex> }[] = []

/**
 * Listening on a port the OS chose, and torn down when the test ends — sockets
 * and all, upgraded ones included.
 *
 * Tracked by hand rather than left to `closeAllConnections()`, which does not
 * reach them: Node stops counting a socket as one of the server's the moment
 * `upgrade` is emitted, and `close()` then waits for it forever. The websocket
 * tests below leave exactly such a socket on both servers, so without this the
 * suite passes its assertions and hangs in the hook afterwards.
 */
async function running(server: http.Server): Promise<number> {
    const sockets = new Set<Duplex>()
    const track = (socket: Duplex): void => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
    }
    server.on('connection', track)
    server.on('upgrade', (_request, socket) => track(socket))

    opened.push({ server, sockets })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
}

afterEach(async () => {
    while (opened.length > 0) {
        const { server, sockets } = opened.pop()!
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
})

async function standInWithUpstream(accounts = ACCOUNTS): Promise<{ port: number; base: string }> {
    const upstreamPort = await running(upstreamDouble())
    const port = await running(createStandIn({ accounts, upstreamPort }))
    return { port, base: `http://127.0.0.1:${port}` }
}

const signedInAs = (account: string): Record<string, string> => ({
    cookie: `${COOKIE}=${encodeURIComponent(account)}`,
})

const seenBy = async (response: Response): Promise<SeenRequest> => (await response.json()) as SeenRequest

describe('a request that has not signed in', () => {
    it('is answered with the chooser, and never reaches the dev server', async () => {
        const { base } = await standInWithUpstream()

        const response = await fetch(`${base}/events/matchplay`)
        const page = await response.text()

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
        // The upstream marks everything it serves, and this is not one of those.
        expect(response.headers.get('x-from')).toBeNull()
        for (const account of ACCOUNTS) expect(page).toContain(account)
        // And it offers to put you back where you were asking to go.
        expect(page).toContain(`continue=${encodeURIComponent('/events/matchplay')}`)
    })

    it('is answered the same way when its cookie names an account no longer on offer', async () => {
        const { base } = await standInWithUpstream()

        const response = await fetch(`${base}/`, { headers: signedInAs('removed@example.com') })

        expect(response.status).toBe(200)
        expect(response.headers.get('x-from')).toBeNull()
        expect(await response.text()).toContain('Choose an account')
    })
})

describe('signing in', () => {
    it('sets the cookie and sends you back where you came from', async () => {
        const { base } = await standInWithUpstream()
        const account = ACCOUNTS[1]!

        const response = await fetch(
            `${base}${SIGN_IN_PATH}?account=${encodeURIComponent(account)}` +
                `&continue=${encodeURIComponent('/players?sort=name')}`,
            { redirect: 'manual' }
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/players?sort=name')
        expect(response.headers.get('set-cookie')).toContain(`${COOKIE}=${encodeURIComponent(account)}`)
        expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    })

    /**
     * The chooser is the only thing that offers an account, but the URL behind
     * it is one anybody can type — and an account this never offered is an
     * identity the admin would then believe in.
     */
    it('refuses an account that was never on offer, and sets nothing', async () => {
        const { base } = await standInWithUpstream()

        const response = await fetch(`${base}${SIGN_IN_PATH}?account=intruder%40example.com`, {
            redirect: 'manual',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('set-cookie')).toBeNull()
    })
})

describe('signing out, which is a URL IAP reads and the application never sees', () => {
    it('clears the cookie and asks again, without troubling the dev server', async () => {
        const { base } = await standInWithUpstream()

        const response = await fetch(`${base}/?gcp-iap-mode=CLEAR_LOGIN_COOKIE`, {
            headers: signedInAs(ACCOUNTS[0]!),
            redirect: 'manual',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
        expect(response.headers.get('x-from')).toBeNull()
    })
})

describe('a request that has signed in', () => {
    it('arrives with the identity IAP would set, not the one it tried to set itself', async () => {
        const { base, port } = await standInWithUpstream()
        const account = ACCOUNTS[0]!

        const response = await fetch(`${base}/operations?tab=runs`, {
            headers: {
                ...signedInAs(account),
                'x-goog-authenticated-user-email': 'accounts.google.com:intruder@example.com',
                'x-goog-iap-jwt-assertion': 'forged',
            },
        })
        const seen = await seenBy(response)

        expect(response.headers.get('x-from')).toBe('upstream')
        expect(seen.url).toBe('/operations?tab=runs')
        expect(seen.headers['x-goog-authenticated-user-email']).toBe(`accounts.google.com:${account}`)
        expect(seen.headers['x-goog-iap-jwt-assertion']).toBe(JWT_ASSERTION_STAND_IN)
        // The host the browser asked for — the stand-in's own port, not the dev
        // server's. Correcting it is what turns every form POST into "Cross-site
        // POST form submissions are forbidden".
        expect(seen.headers.host).toBe(`127.0.0.1:${port}`)
    })

    it('carries a form POST through, method and body', async () => {
        const { base } = await standInWithUpstream()

        const response = await fetch(`${base}/players`, {
            method: 'POST',
            headers: { ...signedInAs(ACCOUNTS[0]!), 'content-type': 'application/x-www-form-urlencoded' },
            body: 'name=Hector',
        })
        const seen = await seenBy(response)

        expect(seen.method).toBe('POST')
        expect(seen.body).toBe('name=Hector')
    })
})

/**
 * There is no dev server to be down any more — it is this process — but the
 * socket can still refuse, and the answer for that should say which of the two
 * servers failed rather than being a stack trace or a hang.
 */
describe('a dev server that does not answer', () => {
    it('is reported as itself, with the stand-in still standing', async () => {
        const vacant = http.createServer()
        const upstreamPort = await running(vacant)
        await new Promise<void>((resolve) => vacant.close(() => resolve()))

        const port = await running(createStandIn({ accounts: ACCOUNTS, upstreamPort }))
        const response = await fetch(`http://127.0.0.1:${port}/`, { headers: signedInAs(ACCOUNTS[0]!) })

        expect(response.status).toBe(502)
        expect(await response.text()).toContain('The dev server did not answer')
    })
})

/**
 * The hot-reload websocket is the reason the second port survives this change:
 * `DevServer` hands out `handle` for requests and nothing for `upgrade`, so the
 * socket stays attached to Astro's own listener and this still forwards it by
 * hand.
 */
describe('the hot-reload websocket', () => {
    const upgrade = (port: number, headers: Record<string, string>) =>
        http.request({
            host: '127.0.0.1',
            port,
            path: '/',
            headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers },
        })

    it('reaches the dev server with an identity, and then carries bytes both ways', async () => {
        const { port } = await standInWithUpstream()
        const account = ACCOUNTS[0]!
        const request = upgrade(port, signedInAs(account))

        const { response, socket } = await new Promise<{ response: http.IncomingMessage; socket: Duplex }>(
            (resolve, reject) => {
                request.on('upgrade', (res, sock) => resolve({ response: res, socket: sock }))
                request.on('error', reject)
                request.end()
            }
        )

        expect(response.statusCode).toBe(101)
        expect(response.headers['x-saw-email']).toBe(`accounts.google.com:${account}`)
        // Casing intact, which is the whole reason the handshake is rebuilt from
        // `rawHeaders` rather than from the parsed object.
        expect(response.rawHeaders).toContain('X-Saw-Email')

        const echoed = new Promise<string>((resolve) =>
            socket.once('data', (chunk: Buffer) => resolve(chunk.toString('utf-8')))
        )
        socket.write('ping')
        expect(await echoed).toBe('echo:ping')
        socket.destroy()
    })

    it('is dropped when nobody has signed in, rather than proxied without an identity', async () => {
        const { port } = await standInWithUpstream()
        const request = upgrade(port, {})

        const outcome = await new Promise<string>((resolve) => {
            request.on('upgrade', () => resolve('upgraded'))
            request.on('response', () => resolve('answered'))
            request.on('error', () => resolve('hung up'))
            request.on('close', () => resolve('hung up'))
            request.end()
        })

        expect(outcome).toBe('hung up')
    })
})

/**
 * The three ways a lost socket used to end the session.
 *
 * All three are an ordinary afternoon — a config file saved while a page is
 * loading, a laptop lid closed on an open tab — and all three mattered less
 * while the dev server was a child process, because the worst of it was an
 * orphan. It is this process now, so each takes the dev server with it.
 *
 * The two resets fail as *unhandled errors* rather than as failed assertions:
 * Node hands an upgraded socket over without its own `error` listener, so an
 * ECONNRESET on one is an uncaught exception, which in a real run is the end of
 * the process and here is a non-zero exit from `vitest run`. Removing either
 * guard from `dev-iap.ts` was checked to do exactly that, so the assertion at
 * the end is a formality and the reset is the test.
 */
describe('a connection lost at the wrong moment', () => {
    /** An upgraded socket, signed in, straight from the stand-in. */
    const upgraded = async (port: number, path: string): Promise<Socket> => {
        const request = http.request({
            host: '127.0.0.1',
            port,
            path,
            headers: { connection: 'Upgrade', upgrade: 'websocket', ...signedInAs(ACCOUNTS[0]!) },
        })
        request.on('error', () => {})
        return new Promise<Socket>((resolve) => {
            request.on('upgrade', (_response, socket) => resolve(socket))
            request.end()
        })
    }

    /** Long enough for a reset to have crashed the process, had it been going to. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

    it('hangs up on the browser when the dev server quits mid-answer, not leaving it waiting', async () => {
        const { base } = await standInWithUpstream()

        // A content-length the dev server is never going to finish. The error
        // arrives on the response rather than on the request, and `pipe` does
        // not carry it across, so unguarded the browser waits out the timeout.
        await expect(
            fetch(`${base}/die-mid-answer`, { headers: signedInAs(ACCOUNTS[0]!) }).then((r) => r.text())
        ).rejects.toThrow()

        // And the stand-in is still standing, which is the whole point.
        const after = await fetch(`${base}/`, { headers: signedInAs(ACCOUNTS[0]!) })
        expect((await seenBy(after)).url).toBe('/')
    })

    it('survives a browser that resets its hot-reload socket', async () => {
        const { base, port } = await standInWithUpstream()
        const socket = await upgraded(port, '/')

        socket.resetAndDestroy()
        await settle()

        expect((await seenBy(await fetch(`${base}/`, { headers: signedInAs(ACCOUNTS[0]!) }))).url).toBe('/')
    })

    it('survives a dev server that resets a hot-reload socket it had accepted', async () => {
        const { base, port } = await standInWithUpstream()
        const socket = await upgraded(port, '/reset-after-handshake')
        socket.on('error', () => {})

        await settle()

        expect((await seenBy(await fetch(`${base}/`, { headers: signedInAs(ACCOUNTS[0]!) }))).url).toBe('/')
    })
})
