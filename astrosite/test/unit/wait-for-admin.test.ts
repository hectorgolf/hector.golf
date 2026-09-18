import { describe, expect, it, vi } from 'vitest'

import { ROUTES } from '../../src/code/admin-api'
import { ask, verdictOf } from '../../scripts/wait-for-admin'

/**
 * Which failures are worth waiting through, and which are a build that is going
 * to fail whatever happens.
 *
 * The distinction is the whole value of this script. Treating every failure as
 * "wait" turns a typo in the IAP audience into three minutes of polling followed
 * by the same error; treating every failure as fatal puts back the race it exists
 * to absorb.
 */
describe('what a status means for waiting', () => {
    it('is ready on a 200', () => {
        expect(verdictOf(200)).toEqual({ ready: true, saw: '200' })
    })

    it('waits through a 404, which is the race itself', () => {
        // The admin is serving the previous image and does not have this route
        // yet. `deploy-admin` takes about a minute; this is what absorbs it.
        const verdict = verdictOf(404)
        expect(verdict.ready).toBe(false)
        expect(verdict.fatal).toBeUndefined()
    })

    it('waits through a 5xx, which is a service still coming up', () => {
        for (const status of [500, 502, 503]) {
            expect(verdictOf(status).ready, `${status}`).toBe(false)
            expect(verdictOf(status).fatal, `${status}`).toBeUndefined()
        }
    })

    /*
     * The one that stops this being a way to spend three minutes discovering a
     * typo. No amount of waiting fixes a wrong audience or a missing grant, and
     * the build is going to fail either way.
     */
    it.each([401, 403])('gives up immediately on a %i, and says why', (status) => {
        const verdict = verdictOf(status)
        expect(verdict.ready).toBe(false)
        expect(verdict.fatal).toMatch(/credential problem rather than a deploy still in flight/)
        expect(verdict.fatal).toMatch(/TF_IAP_OAUTH_CLIENT_ID/)
    })
})

describe('asking', () => {
    it('carries the ID token IAP wants', async () => {
        const doFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 200 }))

        await ask('https://admin.example/api/handicaps/history', 'id-token', doFetch)

        const [, init] = doFetch.mock.calls[0]!
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer id-token')
    })

    /*
     * The first production run finished its work in seven seconds and then held
     * the step for 240 more — Google Front End's idle keep-alive, with nothing
     * left to do but wait to be hung up on. An unread body is why the connection
     * was worth holding.
     */
    it('lets go of the response body, which is all that holds the connection open', async () => {
        // Asserted on the call rather than on the Response afterwards: `cancel()`
        // releases the lock it takes, so a cancelled body and an untouched one
        // look identical from the outside. The contract is that `ask` calls it.
        const cancel = vi.fn().mockResolvedValue(undefined)
        const response = { status: 200, body: { cancel } } as unknown as Response
        const doFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)

        await ask('https://admin.example/api/handicaps/history', 'id-token', doFetch)

        expect(cancel).toHaveBeenCalledOnce()
    })

    it('survives a response with no body to cancel', async () => {
        // A 204, or anything else the far end answers without one. `?.` covers it,
        // and this is here so that removing the `?.` fails rather than only
        // failing in production against a server nobody predicted.
        const doFetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue({ status: 200, body: null } as unknown as Response)

        await expect(ask('https://admin.example/x', 'id-token', doFetch)).resolves.toEqual({
            ready: true,
            saw: '200',
        })
    })

    it('treats no answer at all as worth waiting through', async () => {
        // DNS, TLS, a cold start. Not a reason to give up, and not something
        // `verdictOf` can see because there is no status to judge.
        const doFetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('ECONNREFUSED'))

        const attempt = await ask('https://admin.example/x', 'id-token', doFetch)
        expect(attempt.ready).toBe(false)
        expect(attempt.fatal).toBeUndefined()
        expect(attempt.saw).toMatch(/no answer/)
    })
})

/**
 * The reason this is a script rather than a `curl` loop in the workflow.
 *
 * A list of routes written out in YAML is a list that is correct until the third
 * scrape lands and somebody updates one copy. These come from the same constant
 * the readers use.
 */
describe('the routes it waits for', () => {
    it('is what the site actually reads, from one definition', () => {
        expect(Object.values(ROUTES)).toContain('/api/handicaps/history')
        expect(Object.values(ROUTES)).toContain('/api/handicaps/checks')
    })

    it('has every route start with a slash, so joining a base URL cannot go wrong', () => {
        for (const path of Object.values(ROUTES)) {
            expect(path.startsWith('/'), path).toBe(true)
        }
    })
})
