import { describe, expect, it } from 'vitest'

import {
    IncompleteLookupError,
    clubsOrRefuse,
    type GolfClub,
} from '@hector/wisegolf/src/handicap-source-api.ts'

/**
 * A club-membership scan that could not ask every club refuses to answer.
 *
 * ## Why this test lives in the admin
 *
 * `packages/wisegolf` has no test runner of its own, and the scan this rule
 * belongs to is 140 sequential HTTP requests — untestable without either adding
 * a runner to that package or standing up a fake WiseGolf. So the rule is a pure
 * exported function and this is the suite that already imports the package and
 * has the most to lose if the rule breaks: the admin's club-memberships job is
 * the caller about to grow a writer.
 *
 * ## What it is for
 *
 * `fetchPlayer` returned `undefined` both for "this club says no" and for "this
 * request did not answer", so a throttled scan produced a confident answer. The
 * first production run of the club job, 2026-09-20, drew an HTTP 429 doing
 * exactly this. Harmless while nothing writes; a wrong assignment once something
 * does. `architecture.md` §13 has the long version.
 */

const club = (abbreviation: string): GolfClub => ({
    name: `${abbreviation} Golf`,
    abbreviation,
    sources: [],
})

describe('a complete scan', () => {
    it('answers with what it found', () => {
        expect(clubsOrRefuse('Anders Forss', [club('VGC')], 140, 0)).toEqual([club('VGC')])
    })

    it('answers with nothing when nothing matched, which is a real answer', () => {
        expect(clubsOrRefuse('Anders Forss', [], 140, 0)).toEqual([])
    })
})

describe('a scan that could not ask every club', () => {
    /**
     * The case that motivated this. One found club plus one unasked club is
     * indistinguishable from two found clubs, and the caller's rule is "assign
     * only when exactly one matches" — so answering `[VGC]` here is how a
     * refusal turns into an assignment.
     */
    it('refuses even when it found exactly one, because the missing one may be a second', () => {
        expect(() => clubsOrRefuse('Anders Forss', [club('VGC')], 140, 1)).toThrow(IncompleteLookupError)
    })

    /**
     * Same outcome by a different route, and worth pinning separately: nothing
     * found with a failure is not "not a member anywhere", it is "we do not
     * know".
     */
    it('refuses when it found nothing, rather than reporting a clean negative', () => {
        expect(() => clubsOrRefuse('Anders Forss', [], 140, 1)).toThrow(IncompleteLookupError)
    })

    it('carries the arithmetic, so a log says how bad the run was', () => {
        try {
            clubsOrRefuse('Anders Forss', [], 140, 12)
            expect.unreachable('should have refused')
        } catch (error) {
            expect(error).toBeInstanceOf(IncompleteLookupError)
            const refusal = error as IncompleteLookupError
            expect(refusal.subject).toBe('Anders Forss')
            expect(refusal.asked).toBe(140)
            expect(refusal.failed).toBe(12)
            expect(refusal.message).toContain('12 of 140')
        }
    })

    /**
     * Both existing callers already catch — `update-player-club-memberships.ts`
     * per player, the admin's job per source — so a refusal costs that player a
     * run and nothing else. This asserts the shape they catch on rather than
     * their behaviour, which lives in their own suites.
     */
    it('is an Error, so the catches that already exist keep working', () => {
        const refusal = new IncompleteLookupError('Anders Forss', 140, 1)
        expect(refusal).toBeInstanceOf(Error)
        expect(refusal.name).toBe('IncompleteLookupError')
    })
})
