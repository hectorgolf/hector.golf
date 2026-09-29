import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Execution } from '../src/lib/jobs/execute.ts'

/**
 * The round hook, pinned at the two seams that matter: the key it checks and
 * the job it starts.
 *
 * What is asserted here is what this route decides on its own. That the job
 * publishes the right board is `job-leaderboards.test.ts`; that the lease works
 * is `job-lock.test.ts`. What is left, and is only here, is who gets in, what a
 * valid signal is, and whether a refused caller can make this service do any
 * work at all.
 */

const hooksApiKey = vi.fn<() => Promise<string | undefined>>()
const execute = vi.fn<(...args: unknown[]) => Promise<Execution>>()

vi.mock('../src/lib/secrets.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/secrets.ts')>()
    return { ...actual, hooksApiKey: () => hooksApiKey() }
})

vi.mock('../src/lib/jobs/execute.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/jobs/execute.ts')>()
    return { ...actual, execute: (...args: unknown[]) => execute(...args) }
})

const { POST, ALL } = await import('../src/pages/api/hooks/round.ts')

const KEY = 'the-configured-key'

const ran: Execution = { slug: 'leaderboards', outcome: 'ok', changes: 1, commit: 'abc123' }

const call = (body: unknown, headers: Record<string, string> = { 'x-api-key': KEY }) =>
    POST({
        request: new Request('https://hooks.hector.golf/api/hooks/round', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
    } as Parameters<typeof POST>[0]) as Promise<Response>

describe('POST /api/hooks/round', () => {
    beforeEach(() => {
        hooksApiKey.mockReset().mockResolvedValue(KEY)
        execute.mockReset().mockResolvedValue(ran)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    describe('who it turns away', () => {
        it('refuses a request presenting no key', async () => {
            const response = await call({ phase: 'round-ended' }, {})

            expect(response.status).toBe(401)
            expect(execute).not.toHaveBeenCalled()
        })

        it('refuses a request presenting the wrong key', async () => {
            const response = await call({ phase: 'round-ended' }, { 'x-api-key': 'nope' })

            expect(response.status).toBe(401)
            expect(await response.json()).toEqual({ error: 'unauthorized' })
        })

        it('says the same thing about a wrong key as about no key', async () => {
            const absent = await call({ phase: 'round-ended' }, {})
            const wrong = await call({ phase: 'round-ended' }, { 'x-api-key': 'nope' })

            expect(await absent.json()).toEqual(await wrong.json())
        })

        it('does not read the body of a request it is turning away', async () => {
            // The order the handler exists to guarantee: a stranger must not be
            // able to learn which payloads this service considers well formed.
            const response = await call({ phase: 'not-a-real-phase' }, { 'x-api-key': 'nope' })

            expect(response.status).toBe(401)
        })

        it('admits nobody when it has no key of its own, and says it is a setup step', async () => {
            hooksApiKey.mockResolvedValue(undefined)

            const response = await call({ phase: 'round-ended' })

            expect(response.status).toBe(503)
            expect(await response.json()).toEqual({ error: 'not_configured' })
            expect(execute).not.toHaveBeenCalled()
        })
    })

    describe('what it accepts', () => {
        it.each(['round-started', 'round-ended', 'event-ended'])('accepts the %s signal', async (phase) => {
            const response = await call({ phase, event: 'HECTOR2026', round: 3 })

            expect(response.status).toBe(200)
            expect(await response.json()).toMatchObject({ ran: 'leaderboards', phase })
        })

        it('refuses a phase nobody here recognises', async () => {
            // A word we do not know is a change on their side worth noticing,
            // not a run to start anyway.
            const response = await call({ phase: 'round-abandoned' })

            expect(response.status).toBe(400)
            expect(execute).not.toHaveBeenCalled()
        })

        it('refuses a body that is not an object, and one that is not JSON', async () => {
            expect((await call('[1,2,3]')).status).toBe(400)
            expect((await call('not json at all')).status).toBe(400)
            expect(execute).not.toHaveBeenCalled()
        })

        it('refuses an event id that is not a short identifier', async () => {
            // It reaches a log line and a run-log document, so "a string they
            // sent" is not a length or an alphabet.
            expect((await call({ phase: 'round-ended', event: 'x'.repeat(65) })).status).toBe(400)
            expect((await call({ phase: 'round-ended', event: '../../etc/passwd' })).status).toBe(400)
            expect((await call({ phase: 'round-ended', event: 'HECTOR 2026' })).status).toBe(400)
        })

        it('refuses a round number that is not one', async () => {
            expect((await call({ phase: 'round-ended', round: 0 })).status).toBe(400)
            expect((await call({ phase: 'round-ended', round: 3.5 })).status).toBe(400)
            expect((await call({ phase: 'round-ended', round: '3' })).status).toBe(400)
        })

        it('accepts a signal that names nothing but the phase', async () => {
            expect((await call({ phase: 'event-ended' })).status).toBe(200)
        })
    })

    describe('what it starts', () => {
        it('runs the leaderboards job, and only that', async () => {
            await call({ phase: 'round-ended', event: 'HECTOR2026', round: 3 })

            expect(execute).toHaveBeenCalledOnce()
            const [job] = execute.mock.calls[0] as [{ slug: string }, string]
            expect(job.slug).toBe('leaderboards')
        })

        it('tells the run log which door this came through, and about what', async () => {
            // A run log where the tick, the button, the relay and this are
            // indistinguishable cannot answer why a board moved at 14:32.
            await call({ phase: 'round-ended', event: 'HECTOR2026', round: 3 })

            const [, by] = execute.mock.calls[0] as [unknown, string]
            expect(by).toBe('app.hector.golf (round-ended: HECTOR2026 round 3)')
        })

        it('names the phase even when the caller named nothing else', async () => {
            await call({ phase: 'event-ended' })

            const [, by] = execute.mock.calls[0] as [unknown, string]
            expect(by).toBe('app.hector.golf (event-ended)')
        })
    })

    describe('a method it does not serve', () => {
        const other = (method: string) =>
            ALL({
                request: new Request('https://hooks.hector.golf/api/hooks/round', { method }),
            } as Parameters<typeof ALL>[0]) as Promise<Response> | Response

        /*
         * GET, HEAD and OPTIONS, because those are the ones that reach this
         * handler over HTTP. A PUT, DELETE or PATCH is answered earlier, by
         * Astro's origin check — `403 Cross-site PUT form submissions are
         * forbidden`, in text/plain — and never gets here.
         *
         * Listing them anyway, as this first did, is a test that passes while
         * describing something no client sees. Measured against the built
         * server rather than reasoned about: the three below return 405 and the
         * other three return 403.
         */
        it.each(['GET', 'HEAD', 'OPTIONS'])('answers 405 to %s, in JSON', async (method) => {
            // Astro's own answer for an unexported method is its HTML 404 page,
            // which tells whoever is wiring up app.hector.golf that the
            // endpoint is not there. It is.
            const response = await other(method)

            expect(response.status).toBe(405)
            expect(await response.json()).toEqual({ error: 'method_not_allowed' })
        })

        it('says which method it does serve', async () => {
            expect((await other('GET')).headers.get('allow')).toBe('POST')
        })

        it('answers without asking for the key, because the method is wrong either way', async () => {
            // Cheap, and it keeps an unauthenticated probe from costing a
            // Secret Manager call on a public endpoint.
            hooksApiKey.mockReset()

            expect((await other('GET')).status).toBe(405)
            expect(hooksApiKey).not.toHaveBeenCalled()
        })

        it('is still POST that handles a POST', async () => {
            // `ALL` is a fallback; an exported method wins. If that ever stops
            // being true this endpoint answers 405 to the only caller it has.
            expect((await call({ phase: 'round-ended' })).status).toBe(200)
        })
    })

    describe('what it answers', () => {
        it('passes a run that changed something back as a 200', async () => {
            const response = await call({ phase: 'round-ended' })

            expect(response.status).toBe(200)
            expect(await response.json()).toMatchObject({ changes: 1, commit: 'abc123' })
        })

        it('answers 409 to a signal that arrived while a run was going', async () => {
            // The expected answer to a busy afternoon rather than a fault: two
            // rounds ending seconds apart produce one run and one refusal, and
            // the refusal is right — the run already going publishes the same
            // board.
            execute.mockResolvedValue({
                slug: 'leaderboards',
                outcome: 'skipped',
                changes: 0,
                skipped: 'lease',
                heldBy: 'the schedule',
            })

            expect((await call({ phase: 'round-ended' })).status).toBe(409)
        })

        it('answers 503 when the job itself is missing a credential', async () => {
            execute.mockResolvedValue({
                slug: 'leaderboards',
                outcome: 'skipped',
                changes: 0,
                skipped: 'not-configured',
            })

            expect((await call({ phase: 'round-ended' })).status).toBe(503)
        })

        it('answers 502 when the job failed', async () => {
            execute.mockResolvedValue({
                slug: 'leaderboards',
                outcome: 'failed',
                changes: 0,
                detail: 'could not read the standings',
            })

            const response = await call({ phase: 'round-ended' })

            expect(response.status).toBe(502)
            expect(await response.json()).toMatchObject({ error: 'could not read the standings' })
        })

        it('never lets an answer be cached', async () => {
            expect((await call({ phase: 'round-ended' })).headers.get('cache-control')).toBe('no-store')
            expect((await call({ phase: 'round-ended' }, {})).headers.get('cache-control')).toBe('no-store')
        })
    })
})
