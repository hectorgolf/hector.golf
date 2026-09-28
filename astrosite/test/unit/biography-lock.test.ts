import { expect, describe, it } from 'vitest'
import { biographiesToRegenerate } from '@hector/schemas/src/biographies.ts'
import { getAllPlayers } from '../../src/code/players'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

/**
 * `player.biographyLocked` is somebody taking a paragraph over.
 *
 * ## What it meant, and what it means now
 *
 * It was written because `player.biography` was classed *authored* and treated
 * as *derived*: the generator rewrote all 45 on every run, with no "only if
 * empty" guard and no diff, so a hand-written biography lived about a fortnight
 * and then disappeared in a commit nobody was watching. The lock excluded a
 * player from the run, and this file existed to keep that true — because a lock
 * that stops being honoured looks exactly like a lock that is working, until
 * somebody's paragraph disappears.
 *
 * **The run no longer publishes.** It writes a draft to `/players/biographies`,
 * where somebody reads it beside the current text and decides. The silent
 * overwrite the lock was built against cannot happen by any path, so as of the
 * prompt-fingerprint change the lock no longer excludes anybody: being locked is
 * a poor reason to leave a biography saying a finished Hector is upcoming, and
 * the person who wrote it is the one best placed to judge the replacement.
 *
 * So the assertions below moved rather than went away. What the lock does now is
 * mark a biography as claimed — the run log names those players, and the review
 * page warns before an approval replaces their words. What still must not
 * happen is the *echo*: a biography this run is not replacing is on the page
 * beside everything it writes, and dropping it from the do-not-echo context lets
 * a published sentence reappear under somebody else's name.
 *
 * Generation is not idempotent, which is what made the old loss permanent rather
 * than annoying: each biography is produced partly from the others generated in
 * the same run, so a rerun does not reproduce the previous text and there is
 * nothing to restore an edit from but git. That is still true, and is why an
 * approval over claimed text is a decision somebody makes on purpose.
 */

const player = (over: Partial<Player> = {}): Player =>
    playerSchema.parse({
        id: 'test-player',
        name: { first: 'Test', last: 'Player' },
        contact: { phone: '+358000000000' },
        biography: ['A paragraph.'],
        ...over,
    })

/** Stands in for the fingerprint comparison the admin does; see `biography-fingerprint.ts`. */
const currentlyUpToDate = (ids: string[]) => (candidate: Player) => ids.includes(candidate.id)

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
    it('regenerates everybody when the caller cannot vouch for anyone', () => {
        // The default. A caller with no way to tell should draft for the whole
        // roster rather than silently skip one it cannot answer for.
        const { regenerate, upToDate } = biographiesToRegenerate([player({ id: 'a' }), player({ id: 'b' })])

        expect(regenerate.map((p) => p.id)).toEqual(['a', 'b'])
        expect(upToDate).toEqual([])
    })

    it('splits the roster on the answer it is given, without reordering either side', () => {
        const roster = ['a', 'b', 'c', 'd'].map((id) => player({ id }))

        const { regenerate, upToDate } = biographiesToRegenerate(roster, currentlyUpToDate(['b', 'd']))

        expect(regenerate.map((p) => p.id)).toEqual(['a', 'c'])
        expect(upToDate.map((p) => p.id)).toEqual(['b', 'd'])
    })

    /**
     * The lock is reported, not obeyed. This is the assertion that used to say
     * the opposite, kept in place and inverted so that the change is visible
     * here rather than inferred from its absence.
     */
    it('includes a locked player in the regeneration, and names them as claimed', () => {
        const roster = [player({ id: 'a' }), player({ id: 'b', biographyLocked: true })]

        const { regenerate, claimed } = biographiesToRegenerate(roster)

        expect(regenerate.map((p) => p.id)).toEqual(['a', 'b'])
        expect(claimed.map((p) => p.id)).toEqual(['b'])
    })

    it('does not call a locked player claimed when it is leaving them alone anyway', () => {
        const roster = [player({ id: 'a', biographyLocked: true })]

        const { regenerate, claimed, upToDate } = biographiesToRegenerate(roster, currentlyUpToDate(['a']))

        expect(regenerate).toEqual([])
        expect(upToDate.map((p) => p.id)).toEqual(['a'])
        // `claimed` is the subset of `regenerate`, so there is nothing to warn
        // about: nothing is being offered over this player's text.
        expect(claimed).toEqual([])
    })

    it('reads an explicit false as no lock at all', () => {
        const { claimed } = biographiesToRegenerate([player({ biographyLocked: false })])
        expect(claimed).toEqual([])
    })
})

/**
 * The phrasing a run is told to avoid.
 *
 * The generator is handed `otherGeneratedBiographies` so it does not reuse
 * phrasing across the roster. A biography the run is *not* replacing is still
 * published beside everything it writes, so dropping those players from the
 * context would let the model echo, in a biography it does write, a sentence
 * already on the page under somebody else's name.
 *
 * This used to be seeded from the locked players, which was the same rule stated
 * against the thing that decided who was skipped at the time. It is the
 * up-to-date players now, for the same reason and with the same effect.
 */
describe('the phrasing a run is told to avoid', () => {
    it('starts with what the players it is leaving alone already say', () => {
        const { alreadyPublished } = biographiesToRegenerate(
            [
                player({ id: 'a', biography: ['Being replaced.'] }),
                player({ id: 'b', biography: ['Staying put, first.', 'Staying put, second.'] }),
            ],
            currentlyUpToDate(['b']),
        )

        expect(alreadyPublished).toEqual(['Staying put, first.', 'Staying put, second.'])
    })

    it('starts empty when the whole roster is being rewritten', () => {
        expect(biographiesToRegenerate([player()]).alreadyPublished).toEqual([])
    })

    it('does not trip over a player who has no biography yet', () => {
        // Possible: a player can be current and empty, having had a draft
        // approved with the box cleared.
        const empty = player({ biography: undefined })
        expect(biographiesToRegenerate([empty], currentlyUpToDate(['test-player'])).alreadyPublished).toEqual([])
    })

    /**
     * A locked biography being replaced is *not* in the context, and that is the
     * point rather than an oversight: its wording is on its way out, and telling
     * the model to avoid a sentence it is about to replace would waste the only
     * instruction that keeps the roster from sounding the same.
     */
    it('leaves out a claimed biography that is being redrafted', () => {
        const { alreadyPublished } = biographiesToRegenerate([
            player({ id: 'a', biographyLocked: true, biography: ['Claimed, and being redrafted.'] }),
        ])

        expect(alreadyPublished).toEqual([])
    })
})

/**
 * Against the real roster, because the interesting property of a rule nobody has
 * exercised is that it changes nothing at all.
 */
describe('the committed roster', () => {
    const players = getAllPlayers()

    it('is read, so the assertions below are not vacuous', () => {
        expect(players.length).toBeGreaterThan(40)
    })

    it('has nobody locked, and regenerates in full when nothing is vouched for', () => {
        const { regenerate, claimed, alreadyPublished } = biographiesToRegenerate(players)

        expect(claimed).toEqual([])
        expect(alreadyPublished).toEqual([])
        expect(regenerate.length).toBe(players.length)
    })
})
