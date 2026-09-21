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
    COURSES_ARE_OWNED,
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
 * Courses, the one collection that had no writer to move.
 *
 * Every other mirror here was waiting on a scheduled writer. Courses were
 * waiting on an editor, which is a different and much smaller thing — they got
 * one on 2026-09-21, and with it `COURSES_ARE_OWNED` and both sides of the
 * seed/export pair.
 *
 * The flag is false until somebody decides the editor is worth trusting with
 * seventeen courses. What these pin is that both sides read it, because a flip
 * where only one did is the loop `data-ownership.md` exists to prevent: the
 * export publishing courses while the seed keeps overwriting them from the
 * committed files, reverting every edit within hours.
 */
describe('the courses collection, which the admin authors', () => {
    const read = (path: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), 'utf-8')

    it('is seeded through the same kind of glob constant the others use', () => {
        expect(COURSE_FILES).toBe('courses/*.json')
        expect(read('../scripts/seed.ts')).toContain('COURSE_FILES')
    })

    /**
     * Asserted rather than left implicit, because the gates below only mean
     * something in one direction at a time: while this was false they stopped a
     * premature flip, and now they are what keeps the seed from reverting an
     * authored course. A silent flip back would disarm the second meaning
     * without touching a line of the code that enforces it.
     */
    it('is authored here, the editor and both gates having landed first', () => {
        expect(COURSES_ARE_OWNED).toBe(true)
    })

    it('is gated on the flag in both directions, which is what stops the loop', () => {
        // The export publishes courses only when owned...
        expect(read('../scripts/export.ts')).toContain('if (COURSES_ARE_OWNED) {')
        // ...and the seed overwrites them only when they are not, or on an import.
        expect(read('../scripts/seed.ts')).toContain('if (!COURSES_ARE_OWNED || bootstrap) {')
    })

    it('is covered by the bootstrap refusal, so an import cannot revert an edit', () => {
        expect(read('../scripts/seed.ts')).toContain('authoredCourses')
    })

    it('gets its tees their ids on the way in, which the files do not carry', () => {
        expect(read('../scripts/seed.ts')).toContain('withTeeIds')
    })

    /**
     * The half that does not follow from the code. `export.ts` deciding to
     * publish a collection means nothing if the workflow does not stage the
     * directory — that is an export which runs, reports what it wrote and pushes
     * none of it, and it is a bug this repository shipped for players on
     * 2026-09-21. Courses were staged before they were exportable so the two
     * could never be out of step in the direction that loses work.
     */
    it('is staged by the workflow that publishes an export', () => {
        const workflow = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/export-admin-data.yml'),
            'utf-8'
        )
        expect(workflow).toContain('astrosite/src/data/courses')
    })
})
