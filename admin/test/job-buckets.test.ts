import { describe, expect, it, vi } from 'vitest'

import { hectorEventSchema } from '@hector/schemas/src/events.ts'
import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import {
    BUCKETS_ARE_COMMITTED,
    EVENTS_PATH,
    type BucketDependencies,
    bucketChanges,
    recompute,
} from '../src/lib/jobs/buckets.ts'

/**
 * What the recompute decides, without standing in for GitHub.
 *
 * The split itself is `@hector/schemas/src/buckets.ts` and is tested in
 * astrosite against the same cases it always was. What is tested here is the
 * part that is new: which events are touched, what is reported, and — for as
 * long as `BUCKETS_ARE_COMMITTED` is false — that nothing is written.
 */

const player = (id: string, first: string): Player =>
    ({ id, name: { first, last: 'Player' }, club: 'Tapiola Golf' }) as Player

/** Four players, two clearly apart and two exactly level. */
const players = [player('adam', 'Adam'), player('ben', 'Ben'), player('cec', 'Cec'), player('dee', 'Dee')]

const history: HandicapHistoryEntry[] = [
    { player: 'adam', date: '2026-09-17', handicap: 4.0 },
    { player: 'ben', date: '2026-09-17', handicap: 8.0 },
    { player: 'cec', date: '2026-09-17', handicap: 12.0 },
    { player: 'dee', date: '2026-09-17', handicap: 16.0 },
]

/** Well before the 2026 freeze, which is 08:00 at Konopiště and so 06:00Z. */
const wellBefore = new Date('2026-09-17T06:00:00Z')
const afterTheFreeze = new Date('2026-09-24T07:00:00Z')

const eventJson = (over: Record<string, unknown> = {}) => ({
    id: 'HECTOR2026',
    ignore: false,
    name: 'Test Hector',
    location: 'Konopiště',
    maxStrokesOverPar: 4,
    format: 'hector',
    timing: { start: '2026-09-24', end: '2026-09-27', timezone: 'Europe/Prague' },
    participants: ['adam', 'ben', 'cec', 'dee'],
    ...over,
})

const path = `${EVENTS_PATH}/HECTOR2026.json`

/** Dependencies serving one event, recording what would be written. */
function serving(json: Record<string, unknown>) {
    const replace = vi.fn<BucketDependencies['replace']>().mockResolvedValue({ ok: true, commit: 'abc123' })
    const dependencies: BucketDependencies = {
        listDirectory: async () => [path],
        readFile: async () => serializeJson(json),
        replace,
    }
    return { dependencies, replace }
}

/** The split those four handicaps produce, lowest first. */
const expectedSplit = [
    [
        { id: 'adam', handicap: 4 },
        { id: 'ben', handicap: 8 },
    ],
    [
        { id: 'cec', handicap: 12 },
        { id: 'dee', handicap: 16 },
    ],
]

describe('recomputing the open splits', () => {
    it('works out the split an event should have', async () => {
        const { dependencies } = serving(eventJson())
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result.outcome).toBe('ok')
        expect(result.changes.map((change) => change.subject)).toEqual(['adam', 'ben', 'cec', 'dee'])
        expect(result.changes[0]).toEqual({ subject: 'adam', from: undefined, to: 'bucket 1' })
    })

    it('says nothing about an event whose split is already right', async () => {
        const { dependencies, replace } = serving(eventJson({ buckets: expectedSplit }))
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result).toEqual({ outcome: 'ok', changes: [] })
        expect(replace).not.toHaveBeenCalled()
    })

    it('leaves a locked split alone, which is the whole point of the lock', async () => {
        const { dependencies } = serving(eventJson({ bucketsLocked: true }))
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result).toEqual({ outcome: 'ok', changes: [] })
    })

    it('leaves a split alone once its event has frozen', async () => {
        const { dependencies } = serving(eventJson())
        const result = await recompute(dependencies, players, history, afterTheFreeze, false)
        expect(result).toEqual({ outcome: 'ok', changes: [] })
    })

    it('leaves an event with no participants alone', async () => {
        const { dependencies } = serving(eventJson({ participants: [] }))
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result).toEqual({ outcome: 'ok', changes: [] })
    })

    it('refuses an event with a participant nobody knows about', async () => {
        // The workflow drops these silently, which was survivable while it read
        // players out of the same checkout as the events. This reads them from a
        // mirror, where a document that failed to sync is reachable — and a split
        // quietly missing a player still looks like a valid split.
        const { dependencies, replace } = serving(eventJson({ participants: ['adam', 'ben', 'ghost'] }))
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('ghost')
        expect(replace).not.toHaveBeenCalled()
    })

    it('refuses the whole sweep when an event file does not parse', async () => {
        // A skipped event is one whose split stops being maintained with nothing
        // anywhere saying so. The export makes the same judgement about the same
        // documents.
        const dependencies: BucketDependencies = {
            listDirectory: async () => [path],
            readFile: async () => '{"id":"HECTOR2026","format":"hector"}',
            replace: vi.fn(),
        }
        await expect(recompute(dependencies, players, history, wellBefore, false)).rejects.toThrow(
            /does not match the Hector event schema/
        )
    })
})

describe('shadow mode', () => {
    /**
     * The constant is asserted rather than assumed, so that turning the writes on
     * is a deliberate act that breaks a test naming the bar for it.
     *
     * That bar, from `docs/plans/handicaps-to-firestore.md`: one tick where the
     * buckets actually move and this and `update-handicaps.yml` produce the same
     * split. Agreement on a split that did not change proves nothing.
     */
    it('is still on', () => {
        expect(BUCKETS_ARE_COMMITTED).toBe(false)
    })

    it('reports what it would write, and writes nothing', async () => {
        const { dependencies, replace } = serving(eventJson())
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result.outcome).toBe('ok')
        expect(result.changes.length).toBeGreaterThan(0)
        expect(replace).not.toHaveBeenCalled()
    })

    it('writes nothing on a dry run either, whatever the constant says', async () => {
        const { dependencies, replace } = serving(eventJson())
        await recompute(dependencies, players, history, wellBefore, true)
        expect(replace).not.toHaveBeenCalled()
    })
})

describe('what a split change is reported as', () => {
    const event = hectorEventSchema.parse(eventJson({ buckets: expectedSplit }))

    it('names the players who crossed between halves, and only those', () => {
        const swapped = [
            [
                { id: 'adam', handicap: 4 },
                { id: 'cec', handicap: 12 },
            ],
            [
                { id: 'ben', handicap: 8 },
                { id: 'dee', handicap: 16 },
            ],
        ] as const

        expect(bucketChanges(event, swapped)).toEqual([
            { subject: 'cec', from: 'bucket 2', to: 'bucket 1' },
            { subject: 'ben', from: 'bucket 1', to: 'bucket 2' },
        ])
    })

    it('says so in one line when only the order inside the halves moved', () => {
        // The order within a bucket is not something anybody plays off, and
        // listing every seat would bury the crossings it gets mixed in with.
        const reordered = [
            [
                { id: 'ben', handicap: 8 },
                { id: 'adam', handicap: 4 },
            ],
            [
                { id: 'cec', handicap: 12 },
                { id: 'dee', handicap: 16 },
            ],
        ] as const

        expect(bucketChanges(event, reordered)).toEqual([
            { subject: 'HECTOR2026', from: 'the same halves', to: 'a new order within them' },
        ])
    })

    it('reports a first-ever split as everybody arriving from nowhere', () => {
        const fresh = hectorEventSchema.parse(eventJson())
        expect(bucketChanges(fresh, expectedSplit as never)).toEqual([
            { subject: 'adam', from: undefined, to: 'bucket 1' },
            { subject: 'ben', from: undefined, to: 'bucket 1' },
            { subject: 'cec', from: undefined, to: 'bucket 2' },
            { subject: 'dee', from: undefined, to: 'bucket 2' },
        ])
    })
})
