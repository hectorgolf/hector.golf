import { describe, expect, it } from 'vitest'

import { rateLimitHeaders } from '@hector/wisegolf/src/wisegolf-api.ts'

/**
 * Which response headers get reported while we find out what WiseGolf tells us.
 *
 * Tested because a filter that quietly matches nothing is indistinguishable from
 * a server that sends nothing, and concluding the second when the first is true
 * is precisely the mistake this whole line of work exists to stop making. The
 * log line says "sent no Retry-After and no x- headers" when the result is
 * empty, and that sentence has to be earned.
 */

/** A stand-in for fetch-h2's Headers, which is what the client actually holds. */
const headers = (pairs: Record<string, string>) => ({
    entries: () => Object.entries(pairs)[Symbol.iterator](),
})

describe('the headers worth reporting', () => {
    it('takes Retry-After however the server capitalised it', () => {
        expect(rateLimitHeaders(headers({ 'Retry-After': '30' }))).toEqual({ 'retry-after': '30' })
        expect(rateLimitHeaders(headers({ 'RETRY-AFTER': '30' }))).toEqual({ 'retry-after': '30' })
    })

    /**
     * Every `x-` header rather than a list of names to look for. Guessing at a
     * vendor's spelling of "remaining" is how you conclude there is nothing.
     */
    it('takes every x- header, whatever it is called', () => {
        expect(
            rateLimitHeaders(
                headers({
                    'X-RateLimit-Remaining': '0',
                    'x-ratelimit-reset': '1758387600',
                    'X-Quota-Left': '12',
                })
            )
        ).toEqual({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1758387600',
            'x-quota-left': '12',
        })
    })

    it('leaves the ordinary ones alone, so the line stays readable', () => {
        expect(
            rateLimitHeaders(
                headers({
                    'content-type': 'application/json',
                    date: 'Sat, 20 Sep 2026 17:00:00 GMT',
                    server: 'nginx',
                    'retry-after': '30',
                })
            )
        ).toEqual({ 'retry-after': '30' })
    })

    it('answers nothing when there is nothing, which is itself the finding', () => {
        expect(rateLimitHeaders(headers({ 'content-type': 'application/json' }))).toEqual({})
    })
})
