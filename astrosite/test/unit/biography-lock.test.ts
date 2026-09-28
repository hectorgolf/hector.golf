import { expect, describe, it } from 'vitest'
import { biographiesToRegenerate } from '@hector/schemas/src/biographies.ts'
import { getAllPlayers } from '../../src/code/players'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

/**
 * `player.biographyLocked` is somebody taking a paragraph over.
 *
 * `docs/current/data-ownership.md` classes `player.biography` as *authored* and
 * the code has always treated it as *derived*: `update-player-biographies.ts`
 * regenerates all 45 on every run, with no "only if empty" guard, no diff and no
 * skip. So a hand-written biography lived about a fortnight and then disappeared
 * in a commit nobody was watching — the silent revert that document exists to
 * prevent. This is the flag that stops it, and these are the assertions that
 * make the flag mean something.
 *
 * Generation is not idempotent, which is what makes the loss permanent rather
 * than annoying: each biography is produced partly from the others generated in
 * the same run, so a rerun does not reproduce the previous text and there is
 * nothing to restore an edit from but git.
 *
 * A separate, initially-empty field rather than reinterpreting `biography`
 * itself. Reading "has a biography" as "somebody took this over" is true of all
 * 45 players today and deliberate for none of them, so it would freeze every one
 * of them at once, silently, with nothing left afterwards to tell them apart.
 * Unset starts out meaning what it says.
 */

const player = (over: Partial<Player> = {}): Player =>
    playerSchema.parse({
        id: 'test-player',
        name: { first: 'Test', last: 'Player' },
        contact: { phone: '+358000000000' },
        biography: ['A paragraph.'],
        ...over,
    })

describe('biographyLocked, as a field', () => {
    /*
     * The assertion that makes typing the flag into a JSON file do anything.
     *
     * `playersData` in `src/code/data.ts` loads every player through
     * `PlayerSchema.safeParse(...).data`, and Zod strips unknown keys rather than
     * complaining about them. So before the field was added to the schema,
     * `"biographyLocked": true` in a player file parsed cleanly, vanished on the
     * way through, and the lock did nothing — silently, which is the same failure
     * mode as having no lock at all.
     */
    it('survives the parse that loads a player file', () => {
        expect(player({ biographyLocked: true }).biographyLocked).toBe(true)
    })

    it('is a boolean', () => {
        // Not merely "parses". Zod strips what it does not know, so a schema
        // missing the field would *accept* `'yes'` and drop it; rejecting a
        // non-boolean is only possible once the field is declared.
        expect(playerSchema.safeParse({ ...player(), biographyLocked: 'yes' }).success).toBe(false)
    })

    it('is optional, and stays absent when nobody has set it', () => {
        // Undefaulted on purpose, for the reason `bucketsLocked` is: Firestore
        // stores what Zod produced, so a `.default(false)` would write
        // `"biographyLocked": false` into all 45 player files the first time one
        // round-tripped through an export — 45 lines saying nothing their absence
        // did not already say.
        const parsed = player()
        expect(parsed.biographyLocked).toBeUndefined()
        expect(Object.keys(parsed)).not.toContain('biographyLocked')
    })
})

describe('biographiesToRegenerate()', () => {
    it('rewrites a player nobody has taken over', () => {
        const { regenerate, locked } = biographiesToRegenerate([player()])
        expect(regenerate.map((p) => p.id)).toEqual(['test-player'])
        expect(locked).toEqual([])
    })

    it('leaves a locked player alone, and says which one it left', () => {
        // Named rather than merely dropped: the run logs this list. A lock that
        // stops a rewrite silently reads as a bug the first time somebody wonders
        // why their correction did not take.
        const { regenerate, locked } = biographiesToRegenerate([player({ biographyLocked: true })])
        expect(regenerate).toEqual([])
        expect(locked.map((p) => p.id)).toEqual(['test-player'])
    })

    it('reads an explicit false as no lock at all', () => {
        const { regenerate, locked } = biographiesToRegenerate([player({ biographyLocked: false })])
        expect(regenerate.map((p) => p.id)).toEqual(['test-player'])
        expect(locked).toEqual([])
    })

    it('splits a mixed roster without reordering either side', () => {
        const roster = [
            player({ id: 'a' }),
            player({ id: 'b', biographyLocked: true }),
            player({ id: 'c' }),
            player({ id: 'd', biographyLocked: true }),
        ]
        const { regenerate, locked } = biographiesToRegenerate(roster)
        expect(regenerate.map((p) => p.id)).toEqual(['a', 'c'])
        expect(locked.map((p) => p.id)).toEqual(['b', 'd'])
    })
})

/**
 * The half that is easy to leave out, and the one way this change could make the
 * output worse than not having it.
 *
 * The generator is handed `otherGeneratedBiographies` so it does not reuse
 * phrasing across the roster. A locked biography is still published beside
 * everything the run writes, so dropping those players from the run entirely
 * would hand the model a roster with holes in it — and let it echo, in a
 * biography it *does* write, a sentence already on the page under somebody
 * else's name.
 */
describe('the phrasing a run is told to avoid', () => {
    it('starts with what the locked players already say', () => {
        const { alreadyPublished } = biographiesToRegenerate([
            player({ id: 'a', biography: ['Unlocked prose.'] }),
            player({ id: 'b', biographyLocked: true, biography: ['Locked first.', 'Locked second.'] }),
        ])
        expect(alreadyPublished).toEqual(['Locked first.', 'Locked second.'])
    })

    it('starts empty when nothing is locked, exactly as it did before', () => {
        expect(biographiesToRegenerate([player()]).alreadyPublished).toEqual([])
    })

    it('does not trip over a locked player who has no biography yet', () => {
        // Possible: somebody can lock a player before writing anything, to stop
        // the next run filling the field in for them.
        const locked = player({ biographyLocked: true, biography: undefined })
        expect(biographiesToRegenerate([locked]).alreadyPublished).toEqual([])
    })
})

/**
 * Whether a biography still describes the world it was written in.
 *
 * A biography is written partly out of the next Hector — "is set to make his
 * tenth appearance" — so the morning after that Hector is played, every one of
 * them is wrong in the same way. The job used to stop dead out of season, on
 * the reasoning that there was no upcoming event to write for, which left those
 * sentences on the site for the eleven months in which they were the first thing
 * a visitor read.
 *
 * `currentIfWrittenAfter` is what a run out of season is given: the day the last
 * Hector finished. It has to be a date rather than "has this been done since the
 * last run", because the thing that makes a biography stale is an event, not a
 * schedule.
 */
describe('biographies that predate the Hector just played', () => {
    const ENDED = '2026-09-27'

    it('regenerates one written before the event ended', () => {
        const { regenerate, upToDate } = biographiesToRegenerate(
            [player({ biographyGeneratedAt: '2026-09-20T09:00:00.000Z' })],
            ENDED
        )

        expect(regenerate).toHaveLength(1)
        expect(upToDate).toEqual([])
    })

    it('leaves one written after it alone', () => {
        const { regenerate, upToDate } = biographiesToRegenerate(
            [player({ biographyGeneratedAt: '2026-09-28T09:00:00.000Z' })],
            ENDED
        )

        expect(regenerate).toEqual([])
        expect(upToDate).toHaveLength(1)
    })

    /**
     * The last day of a Hector is a day it is still being played, so a biography
     * written then cannot describe its outcome. `>` rather than `>=` is the
     * whole of that, and it is the boundary worth pinning.
     */
    it('regenerates one written on the closing day, which the event outlived', () => {
        const { regenerate } = biographiesToRegenerate(
            [player({ biographyGeneratedAt: `${ENDED}T18:00:00.000Z` })],
            ENDED
        )

        expect(regenerate).toHaveLength(1)
    })

    /**
     * The state every player was in when the field was added, and the reason
     * "unknown" cannot read as "current": the roster had 45 biographies and no
     * dates, all of them written while the last Hector was still ahead.
     * Treating that as up to date would make the first run after this change a
     * no-op and leave the whole site describing a finished event as coming.
     */
    it('regenerates one with no date at all', () => {
        const { regenerate, upToDate } = biographiesToRegenerate([player()], ENDED)

        expect(regenerate).toHaveLength(1)
        expect(upToDate).toEqual([])
    })

    it('still leaves a locked player alone, however stale their text is', () => {
        const { regenerate, locked } = biographiesToRegenerate(
            [player({ biographyLocked: true, biographyGeneratedAt: '2020-01-01T00:00:00.000Z' })],
            ENDED
        )

        expect(regenerate).toEqual([])
        expect(locked).toHaveLength(1)
    })

    /**
     * An up-to-date biography is on the page beside everything the run writes,
     * exactly as a locked one is, so it belongs in the do-not-echo context for
     * exactly the same reason. Leaving it out would let a run reuse a sentence
     * that is already published under somebody else's name — the failure the
     * locked half of this file exists about.
     */
    it('adds the up-to-date players to the phrasing a run is told to avoid', () => {
        const { alreadyPublished } = biographiesToRegenerate(
            [
                player({ id: 'stale', biography: ['Being rewritten.'] }),
                player({
                    id: 'current',
                    biography: ['Written since the Hector.'],
                    biographyGeneratedAt: '2026-09-28T09:00:00.000Z',
                }),
                player({ id: 'held', biographyLocked: true, biography: ['Claimed by hand.'] }),
            ],
            ENDED
        )

        expect(alreadyPublished).toEqual(['Claimed by hand.', 'Written since the Hector.'])
    })

    /**
     * No cutoff is what a run before an upcoming Hector passes, and it has to go
     * on meaning "everybody unlocked": the field changes as people enter, so a
     * biography written yesterday is no evidence that it names the right event.
     */
    it('ignores the dates entirely when no cutoff is given', () => {
        const players = [
            player({ id: 'a', biographyGeneratedAt: '2026-09-28T09:00:00.000Z' }),
            player({ id: 'b' }),
        ]

        const { regenerate, upToDate } = biographiesToRegenerate(players)

        expect(regenerate).toHaveLength(2)
        expect(upToDate).toEqual([])
    })
})

/**
 * Against the real roster, because the interesting property of a lock nobody has
 * set is that it changes nothing at all.
 */
describe('the committed roster', () => {
    const players = getAllPlayers()

    it('is read, so the assertions below are not vacuous', () => {
        expect(players.length).toBeGreaterThan(40)
    })

    it('has nobody locked, and so regenerates exactly as it always has', () => {
        const { regenerate, locked, alreadyPublished } = biographiesToRegenerate(players)
        expect(locked).toEqual([])
        expect(alreadyPublished).toEqual([])
        expect(regenerate.length).toBe(players.length)
    })
})
