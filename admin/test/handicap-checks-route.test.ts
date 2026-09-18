import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HandicapCheck } from '@hector/schemas/src/handicap-checks.ts'

/**
 * The sweep endpoint, pinned the way `handicaps-history-route.test.ts` pins its
 * sibling: at the store, so what is asserted is the three things this route
 * decides on its own rather than the query behind it.
 *
 * The body format, because a caller has to accept this and the committed backup
 * interchangeably. The cache headers, because a cached answer dates a handicap to
 * the wrong sweep. And what a failure says, because bodies from this service are
 * assumed public and a Firestore error names the project and the collection.
 */
const all = vi.fn<() => Promise<HandicapCheck[]>>()

vi.mock('../src/lib/handicaps/checks.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/handicaps/checks.ts')>()
    return { ...actual, all: () => all() }
})

const { GET } = await import('../src/pages/api/handicaps/checks.ts')

const checks: HandicapCheck[] = [
    { at: '2026-09-18T03:00:53Z', checked: 37, skipped: ['ricke-b'] },
    { at: '2025-09-25T03:24:00Z', checked: 40, skipped: ['eero-s'], approximate: true },
]

const call = (accept?: string) =>
    GET({
        request: new Request('https://admin.example/api/handicaps/checks', {
            headers: accept ? { accept } : {},
        }),
    } as Parameters<typeof GET>[0]) as Promise<Response>

describe('GET /api/handicaps/checks', () => {
    beforeEach(() => {
        all.mockReset()
    })

    it('answers NDJSON that parses back to what the store held', async () => {
        all.mockResolvedValue(checks)
        const { parse } = await import('../src/lib/handicaps/checks.ts')

        const response = await call('application/x-ndjson')
        expect(response.status).toBe(200)

        const back = parse(await response.text())
        expect(back).toHaveLength(checks.length)
        expect(back.map((check) => check.at)).toEqual(expect.arrayContaining(checks.map((check) => check.at)))
    })

    it('keeps `approximate` on the entries that carry it, and off the ones that do not', async () => {
        // The distinction the schema calls the thing that tells a real sweep from
        // a reconstructed one "forever". An endpoint that normalised it would
        // erase that on the way out, where nothing downstream could recover it.
        all.mockResolvedValue(checks)
        const { parse } = await import('../src/lib/handicaps/checks.ts')

        const back = parse(await (await call('application/x-ndjson')).text())
        const real = back.find((check) => check.at === '2026-09-18T03:00:53Z')!
        const reconstructed = back.find((check) => check.at === '2025-09-25T03:24:00Z')!

        expect(real.approximate).toBeUndefined()
        expect(reconstructed.approximate).toBe(true)
    })

    it('answers oldest first, which is the order every reader assumes', async () => {
        all.mockResolvedValue(checks)
        const lines = (await (await call('application/x-ndjson')).text()).trimEnd().split('\n')
        const ats = lines.map((line) => JSON.parse(line).at as string)

        expect(ats).toEqual([...ats].sort())
    })

    it('declares the NDJSON media type, and text for a browser', async () => {
        all.mockResolvedValue(checks)

        expect((await call()).headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
        expect((await call('text/html')).headers.get('content-type')).toBe('text/plain; charset=utf-8')
    })

    it('refuses to be cached', async () => {
        all.mockResolvedValue(checks)
        expect((await call()).headers.get('cache-control')).toBe('no-store')
    })

    it('answers an empty body rather than a broken one for an empty store', async () => {
        all.mockResolvedValue([])
        const response = await call()

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('')
    })

    it('fails with 503 and says nothing about why', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        all.mockRejectedValue(new Error('project hector-golf: collection handicap-checks denied'))

        const response = await call()
        expect(response.status).toBe(503)
        expect(await response.text()).not.toMatch(/hector-golf|handicap-checks/)
        expect(console.error).toHaveBeenCalled()
    })
})
