import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'

/**
 * The endpoint the site build reads, once step 3 has moved the reader.
 *
 * Mocked at the store rather than driven against Firestore, because what is
 * worth pinning here is not the query — `test/handicap-observations.test.ts`
 * already owns `all` and `render` — but the three things this route decides on
 * its own, each of which fails quietly if it is wrong.
 *
 * The body format, because the caller has to accept the endpoint's answer and
 * the committed backup interchangeably. The cache headers, because a cached
 * answer here means publishing yesterday's handicaps as today's, which looks
 * exactly like a successful build. And what a failure says, because response
 * bodies from this service are assumed public and a Firestore error names the
 * project and the collection.
 */
const all = vi.fn<() => Promise<HandicapHistoryEntry[]>>()

vi.mock('../src/lib/handicaps/observations.ts', async (importOriginal) => {
    // `render` is the real one: pinning the body against a stub would assert
    // that this route calls something, not that a build can read what it gets.
    const actual = await importOriginal<typeof import('../src/lib/handicaps/observations.ts')>()
    return { ...actual, all: () => all() }
})

const { GET } = await import('../src/pages/api/handicaps/history.ts')

const entries: HandicapHistoryEntry[] = [
    { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T05:00:35Z' },
    { player: 'lauri-p', date: '2026-09-16', handicap: 12 },
]

/** The route takes no arguments it uses; Astro's context is not consulted. */
const call = () => GET({} as Parameters<typeof GET>[0]) as Promise<Response>

describe('GET /api/handicaps/history', () => {
    beforeEach(() => {
        all.mockReset()
    })

    it('answers NDJSON that parses back to what the store held', async () => {
        all.mockResolvedValue(entries)
        const { parse } = await import('../src/lib/handicaps/observations.ts')

        const response = await call()
        expect(response.status).toBe(200)

        const body = await response.text()
        expect(parse(body)).toEqual(expect.arrayContaining(entries))
        expect(parse(body)).toHaveLength(entries.length)
    })

    it('declares the NDJSON media type and a charset', async () => {
        all.mockResolvedValue(entries)
        const response = await call()

        // `application/x-ndjson` is the registered type. The charset is stated
        // rather than left out because a reader that guessed Latin-1 would mangle
        // nothing today and a player's name later.
        expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    })

    it('refuses to be cached, since a stale answer is a silently wrong deploy', async () => {
        all.mockResolvedValue(entries)
        const response = await call()
        expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('answers an empty body rather than a broken one for an empty store', async () => {
        // The first-run state. `render` returns '' for no entries, and a caller
        // parsing that has to get an empty history rather than a parse error.
        all.mockResolvedValue([])
        const response = await call()

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('')
    })

    it('fails with 503 and says nothing about why', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        all.mockRejectedValue(new Error('project hector-golf: collection handicap-observations denied'))

        const response = await call()
        expect(response.status).toBe(503)

        // The detail belongs in Cloud Logging and nowhere else: this service is
        // built to survive being deployed without IAP in front of it, so bodies
        // are assumed public.
        const body = await response.text()
        expect(body).not.toMatch(/hector-golf|handicap-observations/)
        expect(console.error).toHaveBeenCalled()
    })

    it('is a failure a build can tell from an empty history', async () => {
        // The distinction step 3 rests on. A 200 with no rows means "the store is
        // empty", and a build may publish that; a 503 means "ask again", and a
        // build with credentials has to stop. Same absence of rows, opposite
        // instructions, so they cannot share a status.
        vi.spyOn(console, 'error').mockImplementation(() => {})

        all.mockResolvedValue([])
        const empty = await call()

        all.mockRejectedValue(new Error('nope'))
        const broken = await call()

        expect(empty.status).not.toBe(broken.status)
    })
})
