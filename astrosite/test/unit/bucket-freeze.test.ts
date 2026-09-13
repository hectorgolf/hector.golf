import { expect, describe, it } from 'vitest'
import { bucketsAreOpen, hectorEvents, BUCKETS_FREEZE_AT_HOUR } from '../../src/code/data'
import { hectorEventSchema, type Event } from '@hector/schemas/src/events.ts'

/**
 * Buckets decide the Draft played after round one, so they have to stop moving
 * before anyone tees off on the first morning. The cutoff is 08:00 where the
 * event is, which is the whole reason an event carries a time zone.
 */

const eventAt = (start: string, timezone?: string) =>
    ({ timing: { start, end: start, timezone } }) as Event

/** Konopiště, 24-27 September 2026. CEST, so 08:00 local is 06:00 UTC. */
const hector2026 = eventAt('2026-09-24', 'Europe/Prague')

describe('bucketsAreOpen()', () => {
    it('freezes at 08:00', () => {
        expect(BUCKETS_FREEZE_AT_HOUR).toBe(8)
    })

    describe('on the first morning, where the event is', () => {
        it('is open the evening before', () => {
            expect(bucketsAreOpen(hector2026, new Date('2026-09-23T21:00:00Z'))).toBe(true)
        })

        it('is open a minute before the cutoff', () => {
            expect(bucketsAreOpen(hector2026, new Date('2026-09-24T05:59:00Z'))).toBe(true)
        })

        it('is closed at the cutoff itself', () => {
            expect(bucketsAreOpen(hector2026, new Date('2026-09-24T06:00:00Z'))).toBe(false)
        })

        it('is closed for the rest of the first day', () => {
            // 13:00 UTC is the handicap job's second run, and 15:00 at Konopiště.
            // That run is what used to reshuffle the buckets mid-tournament.
            expect(bucketsAreOpen(hector2026, new Date('2026-09-24T13:00:00Z'))).toBe(false)
        })

        it('is closed during the event', () => {
            expect(bucketsAreOpen(hector2026, new Date('2026-09-26T08:00:00Z'))).toBe(false)
        })

        it('is closed after the event', () => {
            expect(bucketsAreOpen(hector2026, new Date('2027-01-01T00:00:00Z'))).toBe(false)
        })
    })

    describe('the zone is the event\'s, not the runner\'s', () => {
        it('freezes an hour earlier in Helsinki than in Prague', () => {
            const helsinki = eventAt('2026-09-24', 'Europe/Helsinki')
            const at0500Utc = new Date('2026-09-24T05:00:00Z')

            expect(bucketsAreOpen(helsinki, at0500Utc)).toBe(false)
            expect(bucketsAreOpen(hector2026, at0500Utc)).toBe(true)
        })

        it('follows the zone across a daylight saving change', () => {
            // Same place, same wall-clock hour, one hour apart in real time:
            // Prague is UTC+2 in September and UTC+1 in January. A fixed offset
            // would get one of these wrong.
            const winter = eventAt('2026-01-15', 'Europe/Prague')

            expect(bucketsAreOpen(winter, new Date('2026-01-15T06:59:00Z'))).toBe(true)
            expect(bucketsAreOpen(winter, new Date('2026-01-15T07:00:00Z'))).toBe(false)
        })
    })

    describe('an event with no time zone', () => {
        const undated = eventAt('2026-09-24')

        it('closes at the start of the first day in UTC', () => {
            expect(bucketsAreOpen(undated, new Date('2026-09-23T23:59:00Z'))).toBe(true)
            expect(bucketsAreOpen(undated, new Date('2026-09-24T00:00:00Z'))).toBe(false)
        })

        it('errs early rather than late', () => {
            // Wrong in the safe direction: a stale split beats a Draft played
            // against buckets the players were never shown.
            expect(bucketsAreOpen(undated, new Date('2026-09-24T05:00:00Z'))).toBe(false)
            expect(bucketsAreOpen(hector2026, new Date('2026-09-24T05:00:00Z'))).toBe(true)
        })
    })

    it('says no for an event that is not there', () => {
        expect(bucketsAreOpen(undefined, new Date('2020-01-01T00:00:00Z'))).toBe(false)
    })
})

describe('timing.timezone', () => {
    const konopiste = {
        id: 'TEST',
        format: 'hector',
        name: 'Test',
        location: 'Somewhere',
        participants: [],
        maxStrokesOverPar: 4,
        timing: {
            start: '2026-09-24',
            end: '2026-09-27',
            timezone: 'Europe/Prague'
        },
    }

    it('accepts a zone the runtime knows', () => {
        expect(hectorEventSchema.safeParse(konopiste).success).toBe(true)
    })

    it('rejects one it does not, rather than falling back to something', () => {
        // A typo here would otherwise freeze the buckets at 08:00 in the wrong
        // place, which nothing downstream could notice.
        const typo = { ...konopiste, timing: { ...konopiste.timing, timezone: 'Europe/Prage' } }
        expect(hectorEventSchema.safeParse(typo).success).toBe(false)
    })

    it('is optional', () => {
        const { timezone, ...withoutZone } = konopiste.timing
        expect(hectorEventSchema.safeParse({ ...konopiste, timing: withoutZone }).success).toBe(true)
    })

    it('is carried by every Hector on record', () => {
        // The fallback in `bucketsAreOpen` exists for an event created without one;
        // no committed event should be relying on it.
        const missing = hectorEvents.filter((event) => !event.timing.timezone)
        expect(missing.map((event) => event.id)).toEqual([])
    })
})
