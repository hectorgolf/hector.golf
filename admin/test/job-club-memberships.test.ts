import { describe, expect, it, vi } from 'vitest'

import { NullHandicapSource, type GolfClub, type HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { agreedClub, run, type ClubAssignment } from '../src/lib/jobs/club-memberships.ts'

/**
 * The club scrape, in this service instead of on a runner.
 *
 * Everything here is the rule `data-ownership.md` classes as authored — fill
 * only when empty, never overwrite — plus the two ways a run can decline to
 * answer. The rule was arrived at independently in the workflow because it was
 * obviously right for the field, and moving the code is exactly the moment it
 * could stop being true without anybody noticing.
 */

const club = (abbreviation: string, name = `${abbreviation} Golf`): GolfClub => ({
    name,
    abbreviation,
    sources: [],
})

/** First name *is* the id, so the stand-in source below can be keyed on either. */
const player = (id: string, fields: Partial<Player> = {}): Player => ({
    id,
    name: { first: id, last: 'Player' },
    contact: { phone: '+358000000000' },
    ...fields,
})

/** A stand-in source that answers from a map, and can be told to throw. */
const source = (name: string, answers: Record<string, GolfClub[]>, throwFor?: string): HandicapSource =>
    ({
        name,
        resolveClubMembership: async (first: string) => {
            if (throwFor === first) throw new Error('WiseGolf said no')
            return answers[first] ?? []
        },
    }) as unknown as HandicapSource

const deps = (players: Player[], sources: HandicapSource[], assign?: ClubDeps['assign']) => ({
    players: async () => players,
    sources: async () => sources,
    assign,
})
type ClubDeps = Parameters<typeof run>[0]

describe('which club a player is assigned', () => {
    it('takes the one club a source is sure about', async () => {
        const result = await run(
            deps([player('eero-s')], [source('WiseGolf', { 'eero-s': [club('TaG')] })]),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.changes).toEqual([{ subject: 'eero-s', from: undefined, to: 'TaG' }])
    })

    /**
     * Two clubs with a member of that name is not a reason to guess. The
     * workflow refused too; this is the assertion that stops the move quietly
     * losing it.
     */
    it('refuses to guess between two clubs', async () => {
        const result = await run(
            deps([player('eero-s')], [source('WiseGolf', { 'eero-s': [club('TaG'), club('HG')] })]),
            true
        )

        expect(result.changes).toEqual([])
        expect(result.detail).toContain('no club matched exactly one')
    })

    /**
     * `club` is authored: CI fills it only when empty. A player who already has
     * one is never asked about, so there is no path by which this job overwrites
     * somebody's correction.
     */
    it('never asks about a player who already has a club', async () => {
        const asked: string[] = []
        const watching: HandicapSource = {
            name: 'WiseGolf',
            resolveClubMembership: async (first: string) => {
                asked.push(first)
                return [club('TaG')]
            },
        } as unknown as HandicapSource

        const result = await run(
            deps([player('lasse-k', { club: 'TaG' }), player('eero-s')], [watching]),
            true
        )

        expect(asked).toEqual(['eero-s'])
        expect(result.changes.map((c) => c.subject)).toEqual(['eero-s'])
    })

    it('says so, and asks nobody, when every player has a club', async () => {
        const result = await run(deps([player('lasse-k', { club: 'TaG' })], []), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('Every player has a club')
    })
})

describe('agreeing across sources', () => {
    /**
     * The workflow builds `[...new Set(clubs)]` over objects, so the same club
     * returned by two sources is two set members and the player looks ambiguous.
     * Unreachable with one source, and WiseGolf is the only one today — but the
     * code is shaped for several, and this is the version that survives.
     */
    it('counts the same club from two sources once', async () => {
        expect(agreedClub([club('TaG'), { ...club('TaG'), sources: [{ name: 'other', id: '2' }] }])).toEqual(
            expect.objectContaining({ abbreviation: 'TaG' })
        )
    })

    it('has nothing to say about genuinely different clubs', () => {
        expect(agreedClub([club('TaG'), club('HG')])).toBeUndefined()
        expect(agreedClub([])).toBeUndefined()
    })

    it('loses a player to a source that throws, and not the run', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = await run(
            deps(
                [player('eero-s'), player('joakim-g')],
                [source('WiseGolf', { 'eero-s': [club('TaG')], 'joakim-g': [club('HG')] }, 'joakim-g')]
            ),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.changes.map((c) => c.subject)).toEqual(['eero-s'])
    })
})

describe('the two ways this run declines to answer', () => {
    /**
     * A missing credential is nothing attempted, so there is nothing to have
     * failed — `JobOutcome` in `registry.ts` says so, and the distinction is
     * what stops the Operations page calling a deployment without WiseGolf a
     * broken one.
     */
    it('skips when no source is configured, rather than failing', async () => {
        const result = await run(deps([player('eero-s')], []), true)

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('No handicap source')
        expect(result.changes).toEqual([])
    })

    /**
     * The shape a missing credential actually arrives in. `createWisegolfSession`
     * warns and returns one of these rather than throwing, so a job that did not
     * filter them would ask forty-five questions of something that answers "no
     * clubs" to all of them and call the result a successful run.
     */
    it('treats a disabled source as no source, not as a source that found nothing', async () => {
        const result = await run(deps([player('eero-s')], [new NullHandicapSource('WiseGolf')]), true)

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('No handicap source')
    })

    /**
     * The job ships in shadow with no writer, because which store a club goes
     * into is a decision with a plan attached. A live run must therefore refuse
     * out loud — the failure this prevents is a scheduled job reporting `ok`
     * every tick while writing nothing at all.
     */
    it('skips a live run while it has no writer, rather than succeeding at nothing', async () => {
        const result = await run(
            deps([player('eero-s')], [source('WiseGolf', { 'eero-s': [club('TaG')] })]),
            false
        )

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('no writer yet')
        // Still reports what it found, so the run log is not poorer for it.
        expect(result.changes).toEqual([{ subject: 'eero-s', from: undefined, to: 'TaG' }])
    })

    it('writes through the writer once there is one', async () => {
        const written: ClubAssignment[][] = []
        const result = await run(
            deps([player('eero-s')], [source('WiseGolf', { 'eero-s': [club('TaG')] })], async (a) => {
                written.push([...a])
                return { commit: 'abc123' }
            }),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(result.commit).toBe('abc123')
        expect(written[0]?.[0]?.club.abbreviation).toBe('TaG')
    })
})
