import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'
import {
    ALL_FORMATS,
    MIRRORED_FORMATS,
    OWNED_FORMATS,
    PLAYERS_ARE_OWNED,
    PLAYER_FILES,
} from '../src/lib/ownership.ts'

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

/**
 * Players have no set to be in or out of — one collection, one boolean — so the
 * complement they have to satisfy is about the two scripts rather than two
 * lists. `export.ts` publishes players only while the admin owns them and
 * `seed.ts` overwrites them only while it does not, which makes the flag the
 * single thing deciding which direction that collection moves in.
 *
 * Asserted against the source of both scripts rather than by running them. That
 * is a blunt instrument and it is the right one here: what this guards against
 * is somebody adding a second players path that forgets the gate, and a test
 * that imported and ran the scripts would need a Firestore to say anything at
 * all.
 */
describe('the players collection, which has a flag rather than a list', () => {
    const read = (path: string) =>
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), 'utf-8')

    it('is mirrored today, so nothing has moved yet', () => {
        expect(PLAYERS_ARE_OWNED).toBe(false)
    })

    it('is seeded and exported through the same glob, so neither can drift', () => {
        expect(PLAYER_FILES).toBe('players/*.json')
        expect(read('../scripts/export.ts')).toContain('PLAYER_FILES')
        expect(read('../scripts/seed.ts')).toContain('PLAYER_FILES')
    })

    it('is gated on the flag in both directions, which is what stops the loop', () => {
        // The export publishes players only when owned...
        expect(read('../scripts/export.ts')).toContain('if (PLAYERS_ARE_OWNED) {')
        // ...and the seed overwrites them only when they are not, or on an import.
        expect(read('../scripts/seed.ts')).toContain('if (!PLAYERS_ARE_OWNED || bootstrap) {')
    })

    it('is covered by the bootstrap refusal, the gap that used to be events-only', () => {
        expect(read('../scripts/seed.ts')).toContain('authoredPlayers')
    })
})
