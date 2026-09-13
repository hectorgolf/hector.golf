import { expect, describe, it } from 'vitest'
import { isValidIsoInstant, isoInstantNow } from '@hector/schemas/src/dates.ts'
import { schema as handicapEntrySchema } from '@hector/schemas/src/handicaps.ts'

/**
 * `observed` records when a handicap was read, as opposed to `date`, which records
 * the day it belongs to. The two can be a day apart — see docs/handicap-updates.md.
 */

describe('isValidIsoInstant()', () => {
    it('accepts a UTC instant to the second', () => {
        expect(isValidIsoInstant('2026-09-13T03:02:42Z')).toBe(true)
        expect(isValidIsoInstant('2026-09-13T00:00:00Z')).toBe(true)
        expect(isValidIsoInstant('2026-09-13T23:59:59Z')).toBe(true)
    })

    it('rejects anything that is not spelled that exact way', () => {
        expect(isValidIsoInstant('2026-09-13T03:02:42.123Z')).toBe(false) // milliseconds
        expect(isValidIsoInstant('2026-09-13T03:02:42')).toBe(false) // no zone
        expect(isValidIsoInstant('2026-09-13T06:02:42+03:00')).toBe(false) // an offset
        expect(isValidIsoInstant('2026-09-13 03:02:42Z')).toBe(false) // a space
        expect(isValidIsoInstant('2026-09-13')).toBe(false) // a date
    })

    it('rejects times and dates that do not exist', () => {
        expect(isValidIsoInstant('2026-09-13T24:00:00Z')).toBe(false)
        expect(isValidIsoInstant('2026-09-13T03:60:00Z')).toBe(false)
        expect(isValidIsoInstant('2026-02-30T03:02:42Z')).toBe(false)
    })
})

describe('isoInstantNow()', () => {
    it('drops the milliseconds toISOString() would give', () => {
        expect(isoInstantNow(new Date('2026-09-13T03:02:42.987Z'))).toBe('2026-09-13T03:02:42Z')
    })

    it('produces something the schema accepts', () => {
        expect(isValidIsoInstant(isoInstantNow())).toBe(true)
    })

    it('is UTC regardless of where the job runs', () => {
        // 06:02 in Helsinki in September is 03:02 UTC, and the file says so.
        expect(isoInstantNow(new Date('2026-09-13T06:02:42+03:00'))).toBe('2026-09-13T03:02:42Z')
    })
})

describe('a handicap history entry', () => {
    const entry = { player: 'lasse-k', date: '2026-09-13', handicap: 14.7 }

    it('takes an observation time', () => {
        const parsed = handicapEntrySchema.safeParse({ ...entry, observed: '2026-09-13T03:02:42Z' })
        expect(parsed.success).toBe(true)
    })

    it('still parses without one, as the older entries are', () => {
        expect(handicapEntrySchema.safeParse(entry).success).toBe(true)
    })

    it('refuses a malformed one rather than storing it', () => {
        expect(handicapEntrySchema.safeParse({ ...entry, observed: '13.9.2026 03:02' }).success).toBe(false)
        expect(handicapEntrySchema.safeParse({ ...entry, observed: '2026-09-13' }).success).toBe(false)
    })

    it('sorts by observation time as a plain string', () => {
        // The reason the spelling is pinned: no parsing needed to ask which of two
        // observations came first.
        const morning = '2026-09-13T03:02:42Z'
        const afternoon = '2026-09-13T14:11:05Z'
        expect([afternoon, morning].sort()).toEqual([morning, afternoon])
    })
})
