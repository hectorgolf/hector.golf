import { describe, expect, it, vi } from 'vitest'

import { hectorEventSchema } from '@hector/schemas/src/events.ts'
import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { EVENTS_PATH, type BucketDependencies, bucketChanges, recompute } from '../src/lib/jobs/buckets.ts'

/**
 * What the recompute decides, without standing in for GitHub.
 *
 * The split itself is `@hector/schemas/src/buckets.ts` and is tested in
 * astrosite against the same cases it always was. What is tested here is the
 * part that is new: which events are touched, what is written, and what is
 * reported about it.
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

        expect(result).toEqual({ outcome: 'ok', changes: [], committed: [] })
        expect(replace).not.toHaveBeenCalled()
    })

    it('leaves a locked split alone, which is the whole point of the lock', async () => {
        const { dependencies } = serving(eventJson({ bucketsLocked: true }))
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result).toEqual({ outcome: 'ok', changes: [], committed: [] })
    })

    it('leaves a split alone once its event has frozen', async () => {
        const { dependencies } = serving(eventJson())
        const result = await recompute(dependencies, players, history, afterTheFreeze, false)
        expect(result).toEqual({ outcome: 'ok', changes: [], committed: [] })
    })

    it('leaves an event with no participants alone', async () => {
        const { dependencies } = serving(eventJson({ participants: [] }))
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result).toEqual({ outcome: 'ok', changes: [], committed: [] })
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

describe('what it writes', () => {
    it('commits the event whose split moved', async () => {
        const { dependencies, replace } = serving(eventJson())
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result.outcome).toBe('ok')
        expect(replace).toHaveBeenCalledTimes(1)
        const [path, text, message] = replace.mock.calls[0]!
        expect(path).toBe(`${EVENTS_PATH}/HECTOR2026.json`)
        expect(message).toBe('Update the buckets for Test Hector')
        // Written as every data file in this repository is written, because
        // `data-formatting.test.ts` holds the committed files to exactly that.
        expect(text).toBe(serializeJson(eventJson({ buckets: expectedSplit })))
    })

    it('reports the file it committed, which is what decides the deploy', async () => {
        // A commit under `astrosite/` starts a deploy by itself, because this
        // service's token is not GITHUB_TOKEN. `publish()` reads this so the job
        // does not ask for a second build of the same commit.
        const { dependencies } = serving(eventJson())
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result.committed).toEqual([`${EVENTS_PATH}/HECTOR2026.json`])
    })

    it('does not count a commit the helper reported as a no-op', async () => {
        const replace = vi
            .fn<BucketDependencies['replace']>()
            .mockResolvedValue({ ok: true, commit: 'unchanged' })
        const dependencies: BucketDependencies = {
            listDirectory: async () => [path],
            readFile: async () => serializeJson(eventJson()),
            replace,
        }
        const result = await recompute(dependencies, players, history, wellBefore, false)
        expect(result.committed).toEqual([])
    })

    it('fails the run when a commit does not land, and keeps going', async () => {
        const replace = vi
            .fn<BucketDependencies['replace']>()
            .mockResolvedValue({ ok: false, detail: 'lost the race 3 times' })
        const dependencies: BucketDependencies = {
            listDirectory: async () => [path],
            readFile: async () => serializeJson(eventJson()),
            replace,
        }
        const result = await recompute(dependencies, players, history, wellBefore, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('lost the race')
        expect(result.committed).toEqual([])
    })

    it('writes nothing on a dry run, and still says what it would have done', async () => {
        const { dependencies, replace } = serving(eventJson())
        const result = await recompute(dependencies, players, history, wellBefore, true)

        expect(replace).not.toHaveBeenCalled()
        expect(result.changes.length).toBeGreaterThan(0)
        expect(result.committed).toEqual([])
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
