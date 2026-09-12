import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'
import { ALL_FORMATS, MIRRORED_FORMATS, OWNED_FORMATS } from '../src/lib/ownership.ts'

/**
 * The seed and the export must never write the same thing in opposite
 * directions. They are complements by construction here — MIRRORED is derived
 * from OWNED — and these hold that shape so a future format cannot be added to
 * one list and forgotten in the other.
 */
describe('what the admin owns and what it mirrors', () => {
    it('never overlap, because that pair is a loop that eats an edit', () => {
        const overlap = MIRRORED_FORMATS.filter((f) => OWNED_FORMATS.has(f))
        expect(overlap).toEqual([])
    })

    it('together cover every format, so nothing is silently unmanaged', () => {
        expect([...ALL_FORMATS].sort()).toEqual(Object.values(EventFormat).sort())
    })

    it('puts matchplay under the admin, since that is what it can author', () => {
        expect(OWNED_FORMATS.has(EventFormat.Matchplay)).toBe(true)
        expect(MIRRORED_FORMATS).toContain(EventFormat.Hector)
        expect(MIRRORED_FORMATS).toContain(EventFormat.Finnkampen)
    })
})
