import { describe, expect, it } from 'vitest'

import { viewerFromHeaders } from '../src/lib/identity.ts'
import {
    accountsFrom,
    forwardedHeaders,
    identityHeaders,
    JWT_ASSERTION_STAND_IN,
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
