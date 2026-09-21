import { readdirSync, readFileSync } from 'node:fs'
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
    COURSE_FILES,
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

    /**
     * Flipped on 2026-09-21, and asserted rather than left implicit because the
     * gates below only mean something in one direction: while this was false
     * they stopped a premature flip, and now they are what keeps the seed from
     * reverting an authored player. A silent flip back would disarm the second
     * meaning without touching a line of the code that enforces it.
     */
    it('is authored here, both workflows having moved into this service', () => {
        expect(PLAYERS_ARE_OWNED).toBe(true)
    })

    /**
     * The other half of the flip, and the half that is not in this package: a
     * collection moves on the day the admin can author it *and* its scheduled
     * writer has moved. Both writers wrote committed files from GitHub Actions
     * until this day; the files that did it are gone.
     */
    it('has no workflow left that writes a player file', () => {
        const workflows = join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows')
        expect(readdirSync(workflows).filter((file) => file.startsWith('update-player-'))).toEqual([])
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

/**
 * Courses, the one collection with no writer to move.
 *
 * Every other mirror in this repository is waiting on a scheduled writer.
 * Courses are waiting on an editor, which is a different and much smaller thing
 * — so there is deliberately no `COURSES_ARE_OWNED` beside the others, and the
 * seed writes them on no gate at all.
 *
 * What is asserted here is that absence, because it is the sort of thing that
 * gets "fixed" by somebody adding a flag for symmetry: a flag nothing reads is
 * worse than none, and a flag something reads would stop the seed writing a
 * collection nothing else writes either. See `docs/plans/courses-in-the-admin.md`.
 */
describe('the courses collection, which is a mirror with no writer to move', () => {
    const read = (path: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), 'utf-8')

    it('is seeded through the same kind of glob constant the others use', () => {
        expect(COURSE_FILES).toBe('courses/*.json')
        expect(read('../scripts/seed.ts')).toContain('COURSE_FILES')
    })

    it('is seeded on no ownership gate, because nothing else writes it', () => {
        const seed = read('../scripts/seed.ts')
        const line = seed.split('\n').find((l) => l.includes("seed('courses'"))
        expect(line, 'the seed no longer writes courses').toBeDefined()
        expect(seed).not.toContain('COURSES_ARE_OWNED')
    })

    it('gets its tees their ids on the way in, which the files do not carry', () => {
        expect(read('../scripts/seed.ts')).toContain('withTeeIds')
    })

    /**
     * The export is the other half of ownership and courses are not in it yet.
     * Asserted so that adding one is a deliberate act with this test in front of
     * it — an export without `export-admin-data.yml` staging the directory is a
     * publish that reports success and pushes nothing, which is a bug this
     * repository has already shipped once.
     */
    it('is not exported yet, since the admin cannot author one', () => {
        expect(read('../scripts/export.ts')).not.toContain('COURSE_FILES')
    })
})
