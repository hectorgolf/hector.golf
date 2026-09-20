import { describe, expect, it } from 'vitest'

import type { PlayerBiographyInput } from '@hector/schemas/src/biographies.ts'
import { EventFormat, type Event } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import type { GolfClub } from '@hector/wisegolf/src/handicap-source-api.ts'

import { run, type BiographyDependencies } from '../src/lib/jobs/biographies.ts'

/**
 * Regenerating biographies in this service: who, and then whether at all.
 *
 * The deciding half can be wrong *silently* — a lock that stops being honoured
 * looks exactly like a lock that is working, until somebody's paragraph
 * disappears a fortnight later. That is the failure
 * `astrosite/test/unit/biography-lock.test.ts` exists about, and moving the code
 * is when it could quietly stop being true.
 *
 * `biographiesToRegenerate` is tested there and `playerBiographyInput` in
 * `biography-input.test.ts`; neither is re-tested here. What is new is
 * everything around them — the upcoming-Hector gate, the two refusals that make
 * a run before the ownership flip cost nothing, and the decision to stop at the
 * first failed generation rather than collect forty-four copies of one error.
 */

const NOW = new Date('2026-09-20T12:00:00Z')

const player = (id: string, fields: Partial<Player> = {}): Player => ({
    id,
    name: { first: id, last: 'Player' },
    contact: { phone: '+358000000000' },
    biography: ['A paragraph.'],
    ...fields,
})

const hector = (id: string, start: string, participants: string[] = ['eero-s']): Event =>
    ({
        id,
        format: EventFormat.Hector,
        name: id,
        location: 'Somewhere',
        timing: { start, end: start },
        participants,
        ignore: false,
        maxStrokesOverPar: 4,
    }) as Event

type Saved = { id: string; biography: string[] }

/**
 * Owned and generating, which is the interesting configuration.
 *
 * The two gates default *open* here so that a test which cares about one of
 * them has to say so, rather than passing because some unrelated default
 * happened to close first.
 */
const deps = (
    players: Player[],
    events: Event[],
    overrides: Partial<BiographyDependencies> = {}
): BiographyDependencies => ({
    players: async () => players,
    events: async () => events,
    now: () => NOW,
    playersAreOwned: () => true,
    clubs: async () => [],
    generate: async () => ['Generated.'],
    save: async () => {},
    ...overrides,
})

const recording = (saved: Saved[]) => ({
    save: async (player: Player, biography: string[]) => {
        saved.push({ id: player.id, biography })
    },
})

describe('the upcoming-Hector gate', () => {
    /**
     * Out of season there is no event to write for, and the workflow applies the
     * same gate. A successful no-op rather than a failure, because this is the
     * normal state of this job for most of the year.
     */
    it('does nothing, successfully, when no Hector is upcoming', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2025', '2025-09-25')]), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('No upcoming Hector')
    })

    it('does nothing when the upcoming Hector has no field yet', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2027', '2027-09-24', [])]), true)

        expect(result.detail).toContain('No upcoming Hector')
    })

    it('takes the nearest upcoming Hector when there are two', async () => {
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2028', '2028-09-24'), hector('HECTOR2026', '2026-09-24')]),
            true
        )

        expect(result.detail).toContain('HECTOR2026')
    })

    /** An event starting today still counts, matching the site's `isUpcomingEvent`. */
    it('counts a Hector starting today as upcoming', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTORNOW', '2026-09-20')]), true)

        expect(result.detail).toContain('HECTORNOW')
    })
})

describe('who a run would rewrite', () => {
    it('counts the unlocked, and names the ones a lock is holding', async () => {
        const result = await run(
            deps(
                [player('eero-s'), player('lasse-k', { biographyLocked: true })],
                [hector('HECTOR2026', '2026-09-24')]
            ),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('1 biography to regenerate')
        expect(result.detail).toContain('1 left alone (lasse-k Player)')
    })

    /**
     * A `Change` claims a before and an after. A dry run does not generate, so
     * it has no after — and inventing one would put a value in the run log that
     * was never produced.
     */
    it('reports no changes, having generated nothing to report', async () => {
        const saved: Saved[] = []
        const result = await run(deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], recording(saved)), true)

        expect(result.changes).toEqual([])
        expect(result.detail).toContain('Nothing was generated')
        expect(saved).toEqual([])
    })

    it('says so when every biography is locked', async () => {
        const result = await run(
            deps([player('eero-s', { biographyLocked: true })], [hector('HECTOR2026', '2026-09-24')]),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('0 biographies to regenerate')
    })
})

describe('the two ways a live run declines to generate', () => {
    /**
     * The gate the flip is actually blocked on, and the reason it is checked
     * before the first model call rather than left to `savePlayer` to throw
     * about: a run before the flip is not a mistake, and finding that out should
     * not cost forty-five generations.
     */
    it('generates nothing while players are still mirrored', async () => {
        let asked = 0
        const saved: Saved[] = []
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], {
                playersAreOwned: () => false,
                generate: async () => {
                    asked += 1
                    return ['Generated.']
                },
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('PLAYERS_ARE_OWNED')
        expect(asked).toBe(0)
        expect(saved).toEqual([])
    })

    it('generates nothing when there is no key for the function', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], {
                generate: undefined,
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('no key')
        expect(saved).toEqual([])
    })
})

describe('a live run that generates', () => {
    it('saves what the function answered, and reports the paragraph counts', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], {
                generate: async () => ['One.', 'Two.', 'Three.'],
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved).toEqual([{ id: 'eero-s', biography: ['One.', 'Two.', 'Three.'] }])
        expect(result.changes).toEqual([{ subject: 'eero-s', from: '1 paragraph', to: '3 paragraphs' }])
        expect(result.detail).toContain('rewrote 1')
    })

    it('resolves the home club through the committed list, and says so when it cannot', async () => {
        const clubs: GolfClub[] = [{ name: 'Tapiola Golf', abbreviation: 'TaG', sources: [] }]
        const seen: string[] = []

        await run(
            deps(
                [player('eero-s', { club: 'TaG' }), player('lasse-k'), player('anders-f', { club: 'Nope' })],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    clubs: async () => clubs,
                    generate: async (input: PlayerBiographyInput) => {
                        seen.push(input.homeClub)
                        return ['Generated.']
                    },
                }
            ),
            false
        )

        expect(seen).toEqual(['Tapiola Golf', 'unknown', 'unknown'])
    })

    /**
     * Not tidiness. Every biography on the page is a biography the model can
     * echo, so a locked one left out of the seed lets a published sentence
     * reappear under somebody else's name — and the ones written earlier in this
     * same run are on that page too.
     */
    it('seeds the model with the locked biographies and then with its own output', async () => {
        const seen: string[][] = []

        await run(
            deps(
                [
                    player('eero-s'),
                    player('lasse-k', { biographyLocked: true, biography: ['Lasse wrote this.'] }),
                    player('anders-f'),
                ],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        seen.push([...input.otherGeneratedBiographies])
                        return [`About ${input.name}.`]
                    },
                }
            ),
            false
        )

        expect(seen).toEqual([['Lasse wrote this.'], ['Lasse wrote this.', 'About eero-s.']])
    })

    /**
     * A generation failure is almost always the key, the quota or the function
     * being down, and the next player will not do better against any of them.
     * What was written stays written — the workflow behaves the same — and the
     * detail has to say how far it got, or a partial rewrite looks like none.
     */
    it('stops at the first failure and reports how many were written', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps(
                [player('eero-s'), player('lasse-k'), player('anders-f')],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        if (input.name === 'lasse-k') throw new Error('429 Too Many Requests')
                        return ['Generated.']
                    },
                    ...recording(saved),
                }
            ),
            false
        )

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('Wrote 1 before lasse-k Player failed: 429 Too Many Requests')
        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
        expect(result.changes).toHaveLength(1)
    })
})
