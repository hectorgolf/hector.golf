import { expect, describe, it } from 'vitest'
import {
    latestPerDay,
    observationsOn,
    compareObservations,
    type HandicapHistoryEntry,
} from '@hector/schemas/src/handicaps.ts'
import { getPlayerHandicapFromHistory } from '../../src/workflows/update-handicaps'

/**
 * `handicaps.json` is a log of readings, not a table of days. The Golf Union
 * re-runs a failed nightly batch during office hours, so a handicap can be read
 * twice in a day and both readings are kept.
 *
 * Everything that asks about days goes through `latestPerDay`. These pin that the
 * two views stay distinct: the log keeps every reading, the daily view collapses
 * them, and nothing that used to mean "yesterday" quietly starts meaning "this
 * morning".
 */

const entry = (
    player: string,
    date: string,
    handicap: number,
    observed?: string,
): HandicapHistoryEntry => ({ player, date, handicap, observed })

/** Lasse's handicap was read twice on the 13th: 14.7 at dawn, 14.5 after the retry. */
const twoReadingsOnThe13th: HandicapHistoryEntry[] = [
    entry('lasse-k', '2026-09-12', 15.0, '2026-09-12T03:01:11Z'),
    entry('lasse-k', '2026-09-13', 14.7, '2026-09-13T03:02:42Z'),
    entry('lasse-k', '2026-09-13', 14.5, '2026-09-13T13:10:06Z'),
]

describe('latestPerDay()', () => {
    it('keeps the last reading of a day and drops the earlier ones', () => {
        expect(latestPerDay(twoReadingsOnThe13th).map((e) => [e.date, e.handicap])).toEqual([
            ['2026-09-12', 15.0],
            ['2026-09-13', 14.5],
        ])
    })

    it('does not care what order the log is in', () => {
        const shuffled = [twoReadingsOnThe13th[2], twoReadingsOnThe13th[0], twoReadingsOnThe13th[1]]

        expect(latestPerDay(shuffled)).toEqual(latestPerDay(twoReadingsOnThe13th))
    })

    it('leaves a day with one reading alone', () => {
        const single = [entry('lasse-k', '2026-09-13', 14.7, '2026-09-13T03:02:42Z')]

        expect(latestPerDay(single)).toEqual(single)
    })

    it('handles entries written before `observed` existed', () => {
        const old = [entry('lasse-k', '2024-05-19', 14.7), entry('lasse-k', '2024-05-20', 15.0)]

        expect(latestPerDay(old).map((e) => e.handicap)).toEqual([14.7, 15.0])
    })

    it('lets a stamped reading supersede an unstamped one from the same day', () => {
        // The first day this ships: the committed history has an entry with no
        // `observed`, and the next scrape reads a changed handicap on that same
        // date. The stamped one is the later of the two and has to win.
        const mixed = [
            entry('lasse-k', '2026-09-13', 14.4),
            entry('lasse-k', '2026-09-13', 14.5, '2026-09-13T13:10:06Z'),
        ]

        expect(latestPerDay(mixed).map((e) => e.handicap)).toEqual([14.5])
    })

    it('collapses each player separately', () => {
        const mixed = [
            ...twoReadingsOnThe13th,
            entry('toni-m', '2026-09-13', 13.7, '2026-09-13T03:02:42Z'),
        ]
        const byPlayer = latestPerDay(mixed).map((e) => [e.player, e.date, e.handicap])

        expect(byPlayer).toContainEqual(['lasse-k', '2026-09-13', 14.5])
        expect(byPlayer).toContainEqual(['toni-m', '2026-09-13', 13.7])
        expect(byPlayer).toHaveLength(3)
    })

    it('does not mutate the log it is given', () => {
        const log = [...twoReadingsOnThe13th]
        latestPerDay(log)

        expect(log).toEqual(twoReadingsOnThe13th)
    })
})

describe('compareObservations()', () => {
    it('orders two readings of one day by when they were seen', () => {
        const [dawn, afternoon] = [twoReadingsOnThe13th[1], twoReadingsOnThe13th[2]]

        expect(compareObservations(dawn, afternoon)).toBeLessThan(0)
        expect(compareObservations(afternoon, dawn)).toBeGreaterThan(0)
    })

    it('sorts an entry with no observation time first within its day', () => {
        const unstamped = entry('lasse-k', '2026-09-13', 14.9)

        expect(compareObservations(unstamped, twoReadingsOnThe13th[1])).toBeLessThan(0)
    })
})

describe('observationsOn()', () => {
    it('gives every reading of a day, oldest first', () => {
        const readings = observationsOn(twoReadingsOnThe13th, 'lasse-k', '2026-09-13')

        expect(readings.map((e) => [e.handicap, e.observed])).toEqual([
            [14.7, '2026-09-13T03:02:42Z'],
            [14.5, '2026-09-13T13:10:06Z'],
        ])
    })

    it('is empty for a day with nothing on it', () => {
        expect(observationsOn(twoReadingsOnThe13th, 'lasse-k', '2026-09-11')).toEqual([])
    })
})

describe('getPlayerHandicapFromHistory() over a log with two readings in a day', () => {
    it('returns the latest reading as the current handicap', () => {
        expect(getPlayerHandicapFromHistory('lasse-k', twoReadingsOnThe13th)).toBe(14.5)
    })

    it('means yesterday by "previous", not this morning', () => {
        // The whole reason the daily view is a function. Before it, the morning's
        // 14.7 would have counted as the previous handicap and the bucketing sort
        // would have read a day's trend off two readings an hour apart.
        expect(getPlayerHandicapFromHistory('lasse-k', twoReadingsOnThe13th, -1)).toBe(15.0)
    })
})
