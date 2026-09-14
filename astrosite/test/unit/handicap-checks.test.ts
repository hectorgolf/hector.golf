import { expect, describe, it } from 'vitest'
import { type HandicapCheck, schema, lastCheckedFor } from '@hector/schemas/src/handicap-checks.ts'

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

describe('lastCheckedFor()', () => {
    it('is the latest sweep that did not skip the player', () => {
        // The sweep, not just its instant: a caller publishing the timestamp has to
        // publish whether it was reconstructed alongside it.
        expect(lastCheckedFor([morning, midday], 'lasse-k')).toEqual(midday)
        expect(lastCheckedFor([morning, midday], 'ricke-b')).toEqual(morning)
    })

    it('is undefined for a player no sweep has answered for', () => {
        // The point of recording who was skipped: "we checked everyone at 03:02" is
        // false for the player whose club is unknown, and they are the likeliest
        // person to come asking.
        expect(lastCheckedFor([check('2026-09-14T03:02:42Z', ['ricke-b'])], 'ricke-b')).toBeUndefined()
        expect(lastCheckedFor([], 'lasse-k')).toBeUndefined()
    })

    it('answers as of an instant', () => {
        expect(lastCheckedFor([morning, midday, nextMorning], 'lasse-k', '2026-09-14T06:00:00Z')).toEqual(morning)
        expect(lastCheckedFor([morning, midday, nextMorning], 'ricke-b', '2026-09-14T23:00:00Z')).toEqual(morning)
    })

    it('carries the sweep\'s own account of how exact it is', () => {
        const reconstructed = { ...morning, at: '2025-09-25T03:24:00Z', approximate: true }
        expect(lastCheckedFor([reconstructed], 'lasse-k')?.approximate).toBe(true)
        expect(lastCheckedFor([morning], 'lasse-k')?.approximate).toBeUndefined()
    })
})
