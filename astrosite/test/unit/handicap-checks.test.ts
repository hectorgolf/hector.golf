import { expect, describe, it } from 'vitest'
import {
    type HandicapCheck,
    schema,
    latestCheck,
    lastCheckedFor,
} from '@hector/schemas/src/handicap-checks.ts'

/**
 * The sweep log: that we looked, as opposed to what we found. `handicaps.json`
 * records a handicap when it changes, so a handicap that has not moved since
 * August has nothing recent to cite — and "we checked at 03:02 and it is still
 * 15.4" is what the events page has to be able to say.
 */

const check = (at: string, skipped: string[] = [], checked = 40): HandicapCheck => ({ at, checked, skipped })

/** Two sweeps a day, as Cloud Scheduler runs them: 03:00 and 12:00 UTC. */
const morning = check('2026-09-14T03:02:42Z')
const midday = check('2026-09-14T12:01:18Z', ['ricke-b'])
const nextMorning = check('2026-09-15T03:03:10Z')

describe('the handicap check schema', () => {
    it('accepts a sweep', () => {
        expect(schema.parse(morning)).toEqual(morning)
    })

    it('insists on an instant, not a date', () => {
        expect(schema.safeParse({ ...morning, at: '2026-09-14' }).success).toBe(false)
        expect(schema.safeParse({ ...morning, at: '2026-09-14T03:02:42.123Z' }).success).toBe(false)
    })

    it('insists the skipped players are listed, even when there are none', () => {
        const { skipped, ...withoutSkipped } = morning
        expect(schema.safeParse(withoutSkipped).success).toBe(false)
        expect(schema.parse({ ...morning, skipped: [] }).skipped).toEqual([])
    })
})

describe('latestCheck()', () => {
    it('is the most recent sweep', () => {
        expect(latestCheck([morning, midday, nextMorning])).toEqual(nextMorning)
    })

    it('does not depend on the order the log happens to be in', () => {
        expect(latestCheck([nextMorning, morning, midday])).toEqual(nextMorning)
    })

    it('is the most recent sweep at or before an instant', () => {
        // The argument that makes a frozen event answerable: sweeps carry on twice a
        // day for years after a split settles, and the one that explains the split is
        // the last one before it.
        expect(latestCheck([morning, midday, nextMorning], '2026-09-14T12:01:18Z')).toEqual(midday)
        expect(latestCheck([morning, midday, nextMorning], '2026-09-14T12:01:17Z')).toEqual(morning)
    })

    it('is undefined when nothing had been swept yet', () => {
        expect(latestCheck([])).toBeUndefined()
        expect(latestCheck([midday, nextMorning], '2026-09-14T03:00:00Z')).toBeUndefined()
    })
})

describe('lastCheckedFor()', () => {
    it('is the latest sweep that did not skip the player', () => {
        expect(lastCheckedFor([morning, midday], 'lasse-k')).toBe(midday.at)
        expect(lastCheckedFor([morning, midday], 'ricke-b')).toBe(morning.at)
    })

    it('is undefined for a player no sweep has answered for', () => {
        // The point of recording who was skipped: "we checked everyone at 03:02" is
        // false for the player whose club is unknown, and they are the likeliest
        // person to come asking.
        expect(lastCheckedFor([check('2026-09-14T03:02:42Z', ['ricke-b'])], 'ricke-b')).toBeUndefined()
        expect(lastCheckedFor([], 'lasse-k')).toBeUndefined()
    })

    it('answers as of an instant', () => {
        expect(lastCheckedFor([morning, midday, nextMorning], 'lasse-k', '2026-09-14T06:00:00Z')).toBe(morning.at)
        expect(lastCheckedFor([morning, midday, nextMorning], 'ricke-b', '2026-09-14T23:00:00Z')).toBe(morning.at)
    })
})
