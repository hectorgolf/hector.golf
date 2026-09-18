import { describe, expect, it, vi } from 'vitest'

import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { type HandicapReader, decide, isoDateToday, isoInstantNow, scrape, sweepOf } from '../src/lib/jobs/handicaps.ts'

/**
 * What the job decides, without standing in for Firestore, GitHub or WiseGolf.
 *
 * The same seam `fetchUpdatedPlayerRecords` draws in the workflow this replaces:
 * every decision about what gets written is made in `decide`, and the writing
 * only carries it out.
 */

const player = (id: string): Player => ({ id, name: { first: id, last: 'Player' }, club: 'Tapiola Golf' }) as Player

/**
 * A player with no home club.
 *
 * Its own helper rather than `player('a', undefined)`, because a default
 * parameter applies to an explicitly passed `undefined` too — so that spelling
 * quietly produced a player *with* a club and the test passed for the wrong
 * reason.
 */
const clublessPlayer = (id: string): Player => ({ id, name: { first: id, last: 'Player' } }) as Player

const source = (answers: Record<string, number | undefined>): HandicapReader => ({
    name: 'TestSource',
    getPlayerHandicap: async (first: string) => answers[first],
})

const NOON = new Date('2026-09-16T12:00:00.000Z')

describe('stamping a run', () => {
    it('dates entries by the day we looked, in UTC', () => {
        expect(isoDateToday(NOON)).toBe('2026-09-16')
    })

    it('records the observation instant to the second, as the schema requires', () => {
        // The schema refuses anything with milliseconds in it, which is what
        // `toISOString()` produces unaided.
        expect(isoInstantNow(NOON)).toBe('2026-09-16T12:00:00Z')
    })
})

describe('reading the sources', () => {
    it('collects a reading for every player a source answered for', async () => {
        const result = await scrape([player('a'), player('b')], [source({ a: 14.7, b: 9.4 })])
        expect(result.readings).toEqual(new Map([['a', 14.7], ['b', 9.4]]))
        expect(result.skipped).toEqual([])
    })

    it('skips a player with no club rather than asking about one', async () => {
        // The sources key on club, and `update-player-club-memberships` is what
        // fills that field.
        const asked = vi.fn().mockResolvedValue(14.7)
        await scrape([clublessPlayer('a')], [{ name: 'S', getPlayerHandicap: asked }])
        expect(asked).not.toHaveBeenCalled()
    })

    it('falls through to the next source when the first has no answer', async () => {
        const result = await scrape([player('a')], [source({}), source({ a: 14.7 })])
        expect(result.readings.get('a')).toBe(14.7)
    })

    it('treats a source that throws as one that did not answer, and carries on', async () => {
        const angry: HandicapReader = {
            name: 'Angry',
            getPlayerHandicap: async () => {
                throw new Error('WiseGolf said no')
            },
        }
        const result = await scrape([player('a')], [angry, source({ a: 14.7 })])
        expect(result.readings.get('a')).toBe(14.7)
    })

    it('reports a player nobody answered for as skipped, not as a failure', async () => {
        const result = await scrape([player('a'), player('b')], [source({ a: 14.7 })])
        expect(result.readings.has('b')).toBe(false)
        expect(result.skipped).toEqual(['b'])
    })
})

describe('deciding what to write', () => {
    const history: HandicapHistoryEntry[] = [
        { player: 'a', date: '2026-09-15', handicap: 14.7, observed: '2026-09-15T03:00:00Z' },
        { player: 'b', date: '2026-09-15', handicap: 9.4, observed: '2026-09-15T03:00:00Z' },
    ]

    it('writes nothing when every reading matches what we hold', () => {
        const { entries, changes } = decide(history, new Map([['a', 14.7], ['b', 9.4]]), NOON)
        expect(entries).toEqual([])
        expect(changes).toEqual([])
    })

    it('writes an entry for a handicap that moved, stamped with this run', () => {
        const { entries } = decide(history, new Map([['a', 14.5]]), NOON)
        expect(entries).toEqual([
            { date: '2026-09-16', player: 'a', handicap: 14.5, observed: '2026-09-16T12:00:00Z' },
        ])
    })

    it('reports the change it saw, for the run log and the commit message', () => {
        const { changes } = decide(history, new Map([['a', 14.5]]), NOON)
        expect(changes).toEqual([{ subject: 'a', from: '14.7', to: '14.5' }])
    })

    it('records a player we have never seen before, with no previous value', () => {
        const { entries, changes } = decide(history, new Map([['c', 22.0]]), NOON)
        expect(entries).toHaveLength(1)
        expect(changes).toEqual([{ subject: 'c', from: undefined, to: '22' }])
    })

    it('compares against the daily view, not the last raw entry', () => {
        // A day that already holds two readings. The site shows the later one, so
        // that is what "unchanged" has to mean — comparing against the first
        // would re-record the afternoon value every afternoon.
        const twiceToday: HandicapHistoryEntry[] = [
            { player: 'a', date: '2026-09-16', handicap: 14.7, observed: '2026-09-16T03:00:00Z' },
            { player: 'a', date: '2026-09-16', handicap: 14.5, observed: '2026-09-16T09:00:00Z' },
        ]
        expect(decide(twiceToday, new Map([['a', 14.5]]), NOON).entries).toEqual([])
    })

    it('keeps a second reading on a day that already has one, when it differs', () => {
        // The Golf Union re-runs a failed nightly batch during office hours, so
        // both readings are kept and `latestPerDay` decides which one counts.
        const morning: HandicapHistoryEntry[] = [
            { player: 'a', date: '2026-09-16', handicap: 14.7, observed: '2026-09-16T03:00:00Z' },
        ]
        const { entries } = decide(morning, new Map([['a', 14.5]]), NOON)
        expect(entries).toEqual([
            { date: '2026-09-16', player: 'a', handicap: 14.5, observed: '2026-09-16T12:00:00Z' },
        ])
    })

    it('orders its output by player, so two runs do not shuffle the commit message', () => {
        const { changes } = decide([], new Map([['c', 1], ['a', 2], ['b', 3]]), NOON)
        expect(changes.map((change) => change.subject)).toEqual(['a', 'b', 'c'])
    })

    it('starts from nothing without complaining, which is what an empty Firestore is', () => {
        const { entries } = decide([], new Map([['a', 14.7]]), NOON)
        expect(entries).toHaveLength(1)
    })
})

/**
 * The sweep a run attests to, and why its arithmetic has to match the workflow's.
 *
 * Both pipelines write to the same log while the migration is in progress, and
 * `lastCheckedFor` takes the latest sweep that did not skip a player. So a player
 * counted as checked by one pipeline and skipped by the other is dated
 * differently depending on which sweep happened to land last — and that date is
 * published at `/events/hector/:id/handicaps.json`, which app.hector.golf reads.
 *
 * Pinned against `sweepOf` in `astrosite/src/workflows/update-handicaps.ts`,
 * which is the definition being matched rather than a second opinion about it.
 */
describe('the sweep a run records', () => {
    const scraped = (readings: Record<string, number>, skipped: string[]) => ({
        readings: new Map(Object.entries(readings)),
        skipped,
    })

    it('counts the players a source answered for', () => {
        const sweep = sweepOf(scraped({ 'sami-h': 5.2, 'lauri-p': 12 }, ['ricke-b']), '2026-09-18T05:00:35Z')

        expect(sweep).toEqual({
            at: '2026-09-18T05:00:35Z',
            checked: 2,
            skipped: ['ricke-b'],
        })
    })

    it('agrees with the workflow, whose arithmetic it has to match', async () => {
        // `checked = players.length - skipped.length` there; `readings.size`
        // here. The same number by two routes, which is the point — a scrape
        // answers for exactly the players it did not skip.
        const { sweepOf: workflowSweepOf } = await import('../../astrosite/src/workflows/update-handicaps.ts')

        const players = [
            { id: 'sami-h', handicapChecked: true },
            { id: 'lauri-p', handicapChecked: true },
            { id: 'ricke-b', handicapChecked: false },
        ] as Parameters<typeof workflowSweepOf>[0]

        const theirs = workflowSweepOf(players, '2026-09-18T05:00:35Z')
        const ours = sweepOf(scraped({ 'sami-h': 5.2, 'lauri-p': 12 }, ['ricke-b']), '2026-09-18T05:00:35Z')

        expect(ours).toEqual(theirs)
    })

    it('records a sweep that skipped everyone it could not reach, not a count of them', () => {
        // A list rather than a number, because `lastCheckedFor` answers per
        // player. A count could not.
        const sweep = sweepOf(scraped({ 'sami-h': 5.2 }, ['ricke-b', 'panu-l']), '2026-09-18T05:00:35Z')
        expect(sweep.skipped).toEqual(['ricke-b', 'panu-l'])
    })

    it('never claims a sweep is approximate', () => {
        // The field exists to mark entries reconstructed after the fact. A live
        // sweep leaves it off, which is what keeps the two tellable apart.
        const sweep = sweepOf(scraped({ 'sami-h': 5.2 }, []), '2026-09-18T05:00:35Z')
        expect(sweep.approximate).toBeUndefined()
        expect(Object.keys(sweep)).not.toContain('approximate')
    })

    it('stamps the sweep with the instant the run used for its observations', () => {
        // The same `now`, so a sweep and the readings it attests to carry the
        // same timestamp — as the workflow's do, where one `observed` is passed
        // to both writers.
        const now = new Date('2026-09-18T05:00:35.412Z')
        expect(sweepOf(scraped({ 'sami-h': 5.2 }, []), isoInstantNow(now)).at).toBe('2026-09-18T05:00:35Z')
    })
})
