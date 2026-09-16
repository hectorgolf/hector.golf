import { describe, expect, it } from 'vitest'

import { addressToKeep, RUN_REQUEST } from '../src/lib/run-now.ts'

/**
 * The Operations page's buttons go through `fetch` now, and the endpoints behind
 * them answer two different ways depending on what the caller asks for. Which
 * branch the browser gets is decided entirely by the headers pinned here, and
 * getting it wrong does not break loudly: asking for JSON would leave the page
 * un-refreshed after a successful run, which looks like the run not having
 * happened.
 *
 * Pinned against the endpoints' own predicate rather than described in prose, so
 * that a change to either side has to face the other. `test/origin.test.ts` does
 * the same for the callers that are not browsers.
 */
const headers = new Headers(RUN_REQUEST.headers)

/** `wantsHtml`, as all three endpoints spell it. */
const wantsHtml = (accept: string | null) => (accept ?? '').includes('text/html')

describe('how the Operations page asks', () => {
    it('asks for HTML, which is what takes the redirect branch', () => {
        // The point of the redirect branch: the server picks the page and this
        // renders what it sent, instead of rebuilding `?ran=` / `?ranJob=` /
        // `?failedJob=` a second time in the browser and drifting from them.
        expect(wantsHtml(headers.get('accept'))).toBe(true)
    })

    it('sends a content type, like every other caller of these endpoints', () => {
        // Not load-bearing here — the page is same-origin, so Astro's CSRF check
        // passes it regardless — but the no-content-type branch of that check has
        // already cost a day once, and a caller that looks like the others is one
        // fewer way to rediscover it.
        expect(headers.get('content-type')).toBe('application/json')
        expect(RUN_REQUEST.body).toBe('{}')
    })

    it('follows the redirect rather than reporting it', () => {
        // The default, and explicit because the whole design rests on it: the
        // response that comes back is the rendered /operations page.
        expect(RUN_REQUEST.redirect).toBe('follow')
    })

    it('sends the IAP session cookie, without which nothing reaches the service', () => {
        expect(RUN_REQUEST.credentials).toBe('same-origin')
    })

    it('posts', () => {
        expect(RUN_REQUEST.method).toBe('POST')
    })
})

/**
 * What the address bar is left holding.
 *
 * The endpoints answer with a redirect to `/operations?ran=biographies`, and
 * that parameter is how the server says what just happened. It has done its job
 * once the answer is rendered. Left in the address bar it stops being a message
 * and becomes a claim about the page: reload an hour later and the admin still
 * announces that you have asked GitHub to run the biographies, which you have
 * not. A notification describes an event, and an event does not survive being
 * looked at again.
 */
describe('the address left behind after a run', () => {
    it('keeps the path and drops what the server used to report the outcome', () => {
        expect(addressToKeep('http://localhost:4321/operations?ran=biographies')).toBe('/operations')
        expect(addressToKeep('http://localhost:4321/operations?ranJob=handicaps')).toBe('/operations')
        expect(addressToKeep('http://localhost:4321/operations?failedJob=handicaps&reason=not-configured')).toBe(
            '/operations'
        )
    })

    it('drops a fragment too, which would scroll a reload somewhere nobody asked for', () => {
        expect(addressToKeep('http://localhost:4321/operations?ran=scheduled#log')).toBe('/operations')
    })

    it('leaves an address that had nothing to drop alone', () => {
        expect(addressToKeep('http://localhost:4321/operations')).toBe('/operations')
    })
})
