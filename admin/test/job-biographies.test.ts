import { describe, expect, it } from 'vitest'

import type { PlayerBiographyInput } from '@hector/schemas/src/biographies.ts'
import { EventFormat, type Event, type HectorEvent } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import type { GolfClub } from '@hector/wisegolf/src/handicap-source-api.ts'

import {
    CONSECUTIVE_FAILURES_BEFORE_GIVING_UP,
    run,
    runForPlayer,
    type BiographyDependencies,
} from '../src/lib/jobs/biographies.ts'

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

type Saved = { id: string; biography: string[]; eventId: string | undefined }

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
    save: async (player: Player, biography: string[], event: HectorEvent | undefined) => {
        saved.push({ id: player.id, biography, eventId: event?.id })
    },
})

describe('which Hector a run is about', () => {
    /**
     * Out of season the run is about the Hector just played, not nothing.
     *
     * This test used to assert the opposite — "No upcoming Hector, so there is
     * nothing to regenerate for" — and that sentence was the bug: every
     * biography written before that Hector describes it as still to come, so the
     * eleven months in which there is no upcoming event are exactly the months
     * in which the site is wrong and the job declines to say so.
     */
    it('falls back to the Hector just played when none is upcoming', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2025', '2025-09-25')]), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('HECTOR2025 ended')
        expect(result.detail).toContain('1 biography to regenerate')
    })

    it('prefers an upcoming Hector to a finished one', async () => {
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2025', '2025-09-25'), hector('HECTOR2026', '2026-09-24')]),
            true
        )

        expect(result.detail).toContain('HECTOR2026 is upcoming')
    })

    /**
     * An event nobody played is a Hector that was scheduled and did not happen,
     * so it is no yardstick for whether a biography is out of date — the same
     * `hasParticipants` the upcoming side has always applied.
     */
    it('ignores a finished Hector with no field', async () => {
        const result = await run(
            deps([player('eero-s')], [hector('HECTOR2024', '2024-09-25'), hector('HECTOR2025', '2025-09-25', [])]),
            true
        )

        expect(result.detail).toContain('HECTOR2024 ended')
    })

    it('does nothing, successfully, when no Hector has a field at all', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2027', '2027-09-24', [])]), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('No Hector with a field')
    })

    it('does nothing when the upcoming Hector has no field yet and none has been played', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2027', '2027-09-24', [])]), true)

        expect(result.detail).toContain('No Hector with a field')
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

/**
 * After a Hector, only the biographies that predate it.
 *
 * The rule itself is `biographiesToRegenerate`, tested in
 * `astrosite/test/unit/biography-lock.test.ts`. What is pinned here is that the
 * job passes the cutoff at all, and passes it only in the case it belongs to —
 * getting either half wrong is silent. Without the cutoff, every press of the
 * button out of season rewrites all forty-five at a model call each; with it
 * applied before an upcoming Hector, a field that has since changed stops being
 * picked up.
 */
describe('regenerating after a Hector has been played', () => {
    const written = (id: string, at: string | undefined) =>
        player(id, { biographyGeneratedAt: at })

    it('takes the players whose biography predates the event, and says who it left', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps(
                [written('eero-s', '2025-09-20T09:00:00.000Z'), written('lasse-k', '2025-09-30T09:00:00.000Z')],
                [hector('HECTOR2025', '2025-09-25')],
                recording(saved)
            ),
            false
        )

        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
        expect(result.detail).toContain('1 already reflect it')
    })

    it('takes a player who has no date, which is every player before this existed', async () => {
        const saved: Saved[] = []
        await run(
            deps([written('eero-s', undefined)], [hector('HECTOR2025', '2025-09-25')], recording(saved)),
            false
        )

        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
    })

    it('reports a successful no-op once everybody has been rewritten since', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps([written('eero-s', '2025-09-30T09:00:00.000Z')], [hector('HECTOR2025', '2025-09-25')], recording(saved)),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('0 biographies to regenerate')
        expect(saved).toEqual([])
    })

    /**
     * The cutoff is for a finished event only. Before one, the field is still
     * changing, so a biography written yesterday is no evidence that it names
     * the right event or the right number of appearances.
     */
    it('ignores the dates while a Hector is upcoming', async () => {
        const saved: Saved[] = []
        await run(
            deps(
                [written('eero-s', '2026-09-19T09:00:00.000Z'), written('lasse-k', '2026-09-20T09:00:00.000Z')],
                [hector('HECTOR2026', '2026-09-24')],
                recording(saved)
            ),
            false
        )

        expect(saved.map((s) => s.id)).toEqual(['eero-s', 'lasse-k'])
    })

    /**
     * The up-to-date players' text is on the page beside what this run writes,
     * so it belongs in the do-not-echo context for the reason the locked
     * players' text does.
     */
    it('shows the model what the players it skipped already say', async () => {
        const seen: string[][] = []

        await run(
            deps(
                [
                    player('eero-s', { biography: ['Being rewritten.'] }),
                    player('lasse-k', {
                        biography: ['Written since the Hector.'],
                        biographyGeneratedAt: '2025-09-30T09:00:00.000Z',
                    }),
                ],
                [hector('HECTOR2025', '2025-09-25')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        seen.push([...input.otherGeneratedBiographies])
                        return ['Generated.']
                    },
                }
            ),
            false
        )

        expect(seen).toEqual([['Written since the Hector.']])
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
        expect(saved).toEqual([{ id: 'eero-s', biography: ['One.', 'Two.', 'Three.'], eventId: 'HECTOR2026' }])
        expect(result.changes).toEqual([{ subject: 'eero-s', from: '1 paragraph', to: '3 paragraphs' }])
        expect(result.detail).toContain('drafted 1 for review')
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
     * One failure is a bad draw, not a verdict on the run.
     *
     * This test used to assert the opposite — the run stopped at the first
     * failure — and on 2026-09-28 that cost 41 players, because the failure was
     * `[503] This model is currently experiencing high demand`. The function
     * retries that itself now; this is the second line, for a spike that outlasts
     * the retries.
     */
    it('carries on past a single failure and drafts the rest', async () => {
        const saved: Saved[] = []
        const result = await run(
            deps(
                [player('eero-s'), player('lasse-k'), player('anders-f')],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        if (input.name === 'lasse-k') throw new Error('503 Service Unavailable')
                        return ['Generated.']
                    },
                    ...recording(saved),
                }
            ),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved.map((s) => s.id)).toEqual(['eero-s', 'anders-f'])
        expect(result.detail).toContain('drafted 2 for review')
        expect(result.detail).toContain('1 could not be drafted (lasse-k Player)')
        // No `Change` for the one that failed: a change claims an after, and a
        // failure has none.
        expect(result.changes.map((c) => c.subject)).toEqual(['eero-s', 'anders-f'])
    })

    /**
     * The half the old behaviour was right about. A dead key or an exhausted
     * quota fails every time, and the run should find that out in three calls
     * rather than forty-five.
     */
    it('gives up once enough have failed in a row', async () => {
        const saved: Saved[] = []
        const roster = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id))
        const result = await run(
            deps(roster, [hector('HECTOR2026', '2026-09-24')], {
                generate: async () => {
                    throw new Error('401 Unauthorized')
                },
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain(`gave up after ${CONSECUTIVE_FAILURES_BEFORE_GIVING_UP} failures in a row`)
        expect(result.detail).toContain('401 Unauthorized')
        expect(saved).toEqual([])
    })

    /**
     * Consecutive rather than total, which is what lets one number serve both
     * cases: a run that is mostly working finishes, however many bad draws it
     * accumulates along the way.
     */
    it('lets a success reset the count, so an intermittent spike does not end the run', async () => {
        const saved: Saved[] = []
        const roster = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id))
        // Fails two in a row, succeeds, fails two more, succeeds — five of six
        // attempts go wrong and none of them is the third in a row.
        const failing = new Set(['a', 'b', 'd', 'e'])
        const result = await run(
            deps(roster, [hector('HECTOR2026', '2026-09-24')], {
                generate: async (input: PlayerBiographyInput) => {
                    if (failing.has(input.name)) throw new Error('503 Service Unavailable')
                    return ['Generated.']
                },
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved.map((s) => s.id)).toEqual(['c', 'f'])
        expect(result.detail).toContain('4 could not be drafted')
    })

    it('keeps what it drafted before giving up', async () => {
        const saved: Saved[] = []
        const roster = ['a', 'b', 'c', 'd', 'e'].map((id) => player(id))
        const result = await run(
            deps(roster, [hector('HECTOR2026', '2026-09-24')], {
                generate: async (input: PlayerBiographyInput) => {
                    if (input.name === 'a') return ['Generated.']
                    throw new Error('503 Service Unavailable')
                },
                ...recording(saved),
            }),
            false
        )

        expect(result.outcome).toBe('failed')
        expect(saved.map((s) => s.id)).toEqual(['a'])
        expect(result.detail).toContain('Drafted 1')
        expect(result.changes).toHaveLength(1)
    })

    /**
     * A player who failed was not rewritten, so what they say now stays on the
     * page beside everything the rest of the run writes — which is exactly the
     * condition the do-not-echo context exists for. The successes contribute
     * their new text; this is the same rule for the ones who did not.
     */
    it('shows the model the existing text of a player it could not draft', async () => {
        const seen: string[][] = []

        await run(
            deps(
                [player('eero-s', { biography: ['Eero keeps this paragraph.'] }), player('lasse-k')],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        seen.push([...input.otherGeneratedBiographies])
                        if (input.name === 'eero-s') throw new Error('503 Service Unavailable')
                        return ['Generated.']
                    },
                }
            ),
            false
        )

        expect(seen).toEqual([[], ['Eero keeps this paragraph.']])
    })
})

/**
 * Drafting for one named player, which is a different question from the sweep's.
 *
 * The sweep asks "who should be rewritten before the next Hector"; this asks
 * "write one for this person, now". Everything below is somewhere the second
 * answer differs from the first, and each of them is a place where reusing the
 * sweep's rule would have been the obvious thing and the wrong one.
 */
describe('drafting for one player', () => {
    it('drafts out of season, against the Hector just played', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2025', '2025-09-25')], recording(saved)),
            'eero-s',
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
        /*
         * The same `referenceHector` the sweep takes, which is the point: this
         * recorded no event at all until the sweep learned to run after a
         * Hector, and two drafts made the same afternoon then disagreed about
         * which Hector they were about — one saying HECTOR2025, the other
         * nothing.
         */
        expect(saved[0]?.eventId).toBe('HECTOR2025')
        expect(result.detail).toContain('HECTOR2025')
    })

    it('records no event when the store holds no Hector anybody played', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2027', '2027-09-24', [])], recording(saved)),
            'eero-s',
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved[0]?.eventId).toBeUndefined()
        expect(result.detail).toContain('no Hector on record')
    })

    /**
     * The sweep would skip this player; the button must not. Naming somebody is
     * the answer to "who needs one", so a request for a biography written after
     * the last Hector still produces a draft.
     */
    it('drafts for a player the sweep would call up to date', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps(
                [player('eero-s', { biographyGeneratedAt: '2025-09-30T09:00:00.000Z' })],
                [hector('HECTOR2025', '2025-09-25')],
                recording(saved)
            ),
            'eero-s',
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
    })

    it('names the upcoming Hector on the draft when there is one', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], recording(saved)),
            'eero-s',
            false
        )

        expect(saved[0]?.eventId).toBe('HECTOR2026')
        expect(result.detail).toContain('HECTOR2026')
    })

    /**
     * The lock stops the *scheduled* rewrite; it is what makes an edit survive
     * the fortnight. Somebody pressing a button beside a locked biography is not
     * what it protects against — and nothing is published either way, since the
     * draft still has to be approved. The warning belongs on the approve button,
     * which is where something is actually overwritten.
     */
    it('drafts for a locked player, which the sweep refuses to do', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s', { biographyLocked: true })], [hector('HECTOR2026', '2026-09-24')], recording(saved)),
            'eero-s',
            false
        )

        expect(result.outcome).toBe('ok')
        expect(saved.map((s) => s.id)).toEqual(['eero-s'])
        expect(result.detail).toContain('locked')
    })

    it('generates for that player and nobody else', async () => {
        const asked: string[] = []
        const saved: Saved[] = []
        await runForPlayer(
            deps([player('eero-s'), player('lasse-k'), player('anders-f')], [hector('HECTOR2026', '2026-09-24')], {
                generate: async (input: PlayerBiographyInput) => {
                    asked.push(input.name)
                    return ['Generated.']
                },
                ...recording(saved),
            }),
            'lasse-k',
            false
        )

        expect(asked).toEqual(['lasse-k'])
        expect(saved.map((s) => s.id)).toEqual(['lasse-k'])
    })

    /**
     * Wider than the sweep's seed, and deliberately. The sweep seeds only the
     * locked biographies because the unlocked ones are about to be replaced in
     * the same run — quoting them would be forbidding sentences on their way
     * out. Nothing else is being replaced here, so every other player's text
     * will still be on the page beside this one, which is the condition the
     * do-not-echo context exists for.
     */
    it('shows the model every other biography, locked or not', async () => {
        const seen: string[][] = []

        await runForPlayer(
            deps(
                [
                    player('eero-s', { biography: ['Eero is being rewritten.'] }),
                    player('lasse-k', { biographyLocked: true, biography: ['Lasse wrote this.'] }),
                    player('anders-f', { biography: ['Anders was generated.'] }),
                ],
                [hector('HECTOR2026', '2026-09-24')],
                {
                    generate: async (input: PlayerBiographyInput) => {
                        seen.push([...input.otherGeneratedBiographies])
                        return ['Generated.']
                    },
                }
            ),
            'eero-s',
            false
        )

        // Both of the others, and not the player's own text: feeding that back
        // would be asking for a paragraph unlike the one being replaced, which
        // is a different instruction from the one this gives.
        expect(seen).toEqual([['Lasse wrote this.', 'Anders was generated.']])
    })

    it('reports the paragraph counts as a change, the same as the sweep', async () => {
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], {
                generate: async () => ['One.', 'Two.'],
            }),
            'eero-s',
            false
        )

        expect(result.changes).toEqual([{ subject: 'eero-s', from: '1 paragraph', to: '2 paragraphs' }])
    })

    it('keeps both gates: mirrored players, and no key', async () => {
        const mirrored = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], { playersAreOwned: () => false }),
            'eero-s',
            false
        )
        expect(mirrored.outcome).toBe('skipped')
        expect(mirrored.detail).toContain('PLAYERS_ARE_OWNED')

        const keyless = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], { generate: undefined }),
            'eero-s',
            false
        )
        expect(keyless.outcome).toBe('skipped')
        expect(keyless.detail).toContain('no key')
    })

    it('writes nothing on a dry run', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], recording(saved)),
            'eero-s',
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.changes).toEqual([])
        expect(saved).toEqual([])
    })

    it('reports a generation failure without a partial count to explain', async () => {
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], {
                generate: async () => {
                    throw new Error('429 Too Many Requests')
                },
            }),
            'eero-s',
            false
        )

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('429 Too Many Requests')
    })

    /**
     * Unreachable through the endpoint, which looks the player up first and
     * answers 404 — precisely so that a bad URL does not leave a red entry in
     * the run log. Pinned because that endpoint is the only thing keeping it so.
     */
    it('fails, rather than quietly doing nothing, for a player who is not there', async () => {
        const saved: Saved[] = []
        const result = await runForPlayer(
            deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')], recording(saved)),
            'nobody',
            false
        )

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('nobody')
        expect(saved).toEqual([])
    })
})
