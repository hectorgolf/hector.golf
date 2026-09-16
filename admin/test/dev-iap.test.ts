import { existsSync, readFileSync } from 'node:fs'
import { Duplex } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { viewerFromHeaders } from '../src/lib/identity.ts'
import {
    accountsFrom,
    exitMessage,
    handshakeResponse,
    joinUpgradedSockets,
    forwardedHeaders,
    FOREGROUND_FLAGS,
    foregroundEnvironment,
    identityHeaders,
    JWT_ASSERTION_STAND_IN,
    QUICK_EXIT_MS,
    readCookie,
    safeContinue,
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
 * The stand-in proxies to a server it supervises, so a dev server that
 * daemonises is fatal to it: the spawned process exits at once, the stand-in
 * follows it down, and the whole thing is over about a second after it started.
 *
 * Astro 7.3 daemonises on its own when `am-i-vibing` recognises an AI coding
 * agent around it, so this broke for exactly the people running it from one and
 * for nobody else — which is a good deal of why it sat there.
 *
 * Pinned against Astro's own source rather than described in prose, the way
 * `origin.test.ts` pins the CSRF callers. The mechanism is undocumented and
 * belongs to somebody else, so the thing worth defending is that an upgrade
 * which changes it fails here instead of quietly restoring the bug.
 */
describe('keeping the dev server in the foreground', () => {
    // Hoisted to the workspace root or kept local, the same two places
    // `astroBinary` looks for the binary.
    const astroDevSource = ['../node_modules', '../../node_modules']
        .map((base) => new URL(`${base}/astro/dist/cli/dev/index.js`, import.meta.url))
        .filter((candidate) => existsSync(candidate))
        .map((candidate) => readFileSync(candidate, 'utf-8'))[0]!

    it('still turns off the agent detection Astro backgrounds for', () => {
        // The line this rests on:
        //   const agentDetected = !process.env.ASTRO_DEV_BACKGROUND && isRunByAgent()
        expect(astroDevSource).toContain('!process.env.ASTRO_DEV_BACKGROUND')
        expect(astroDevSource).toContain('isRunByAgent()')
    })

    it('sets the variable to something non-empty, since Astro only tests truthiness', () => {
        const value = foregroundEnvironment({}).ASTRO_DEV_BACKGROUND
        expect(value).toBeTruthy()
        // An empty string would read as unset and put the detection straight back.
        expect(value).not.toBe('')
    })

    it('leaves a value already in the environment alone', () => {
        expect(foregroundEnvironment({ ASTRO_DEV_BACKGROUND: 'theirs' }).ASTRO_DEV_BACKGROUND).toBe('theirs')
    })

    it('keeps the rest of the environment, which is where PATH and the emulator host live', () => {
        const environment = foregroundEnvironment({ FIRESTORE_EMULATOR_HOST: 'localhost:8432' })
        expect(environment.FIRESTORE_EMULATOR_HOST).toBe('localhost:8432')
    })

    it('asks for no lock file, because this server is not one `astro dev stop` should find', () => {
        expect(FOREGROUND_FLAGS).toContain('--ignore-lock')
        // And Astro still refuses that flag alongside backgrounding, which is
        // what makes a regression here loud rather than silent.
        expect(astroDevSource).toContain('getBackgroundIgnoreLockConflict')
    })
})

describe('what it says when the dev server stops', () => {
    it('names the cause when the exit is immediate and clean, which only daemonising is', () => {
        const message = exitMessage(0, QUICK_EXIT_MS - 1)
        expect(message).toContain('daemonised')
        expect(message).toContain('FOREGROUND_FLAGS')
    })

    it('reports a server that ran and then stopped as just that', () => {
        expect(exitMessage(0, QUICK_EXIT_MS + 1)).toBe('astro dev exited (0); stopping the stand-in too.')
        expect(exitMessage(1, 50)).toBe('astro dev exited (1); stopping the stand-in too.')
    })

    it('says "signal" rather than "null" for a server that was killed', () => {
        expect(exitMessage(null, 10_000)).toContain('(signal)')
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
