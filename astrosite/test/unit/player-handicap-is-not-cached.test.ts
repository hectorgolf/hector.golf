import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { getPlayerHandicapById } from '../../src/code/players'

/**
 * No committed player file caches a handicap the history already knows.
 *
 * `player.handicap` has always meant two things: a stopgap somebody typed for a
 * player WiseGolf has never heard of, and a cache of the scrape's latest reading.
 * `docs/current/data-ownership.md` calls that one of the hard rows. Since step 3
 * the site resolves `player.handicap ?? latest-from-the-history` and the history
 * is a fetch away, so the second meaning is a second source of truth for no
 * benefit — and the forty files carrying one have had it removed.
 *
 * This is the assertion that keeps them removed. It is not hypothetical: the
 * field was written back by three workflows, not one. `getPlayerById` resolves
 * the handicap before returning, so anything reading a player and writing it back
 * persists the resolved value, and `update-player-biographies.ts` and
 * `update-player-club-memberships.ts` both do on every run. Deleting the obvious
 * write would have left the field looking maintained while nothing maintained it;
 * this fails the moment that starts happening again.
 */
describe('the handicap in a committed player file', () => {
    const players = globSync('src/data/players/*.json').map(
        (path) => JSON.parse(readFileSync(path, 'utf-8')) as { id: string; handicap?: number }
    )

    it('reads every committed player, so the assertions below are not vacuous', () => {
        expect(players.length).toBeGreaterThan(40)
    })

    it('is absent wherever the history has one', () => {
        const cached = players
            .filter((player) => player.handicap !== undefined)
            .filter((player) => getPlayerHandicapById(player.id) !== undefined)
            .map((player) => `${player.id} (file says ${player.handicap})`)

        expect(
            cached,
            'These duplicate what the history already says. `updatePlayerData` drops a derived ' +
                'handicap; something has started writing one another way.'
        ).toEqual([])
    })

    /*
     * The other half, and the reason the field is not simply deleted from the
     * schema. A player the history says nothing about has nowhere else to keep a
     * handicap, and that is exactly what the stopgap is for. No player is in that
     * state today, so this asserts the capability rather than an instance.
     */
    it('is still allowed for a player the history knows nothing about', () => {
        const stopgapWouldBeKept = players.filter((player) => getPlayerHandicapById(player.id) === undefined)

        for (const player of stopgapWouldBeKept) {
            // Nothing forces them to have one; the point is that carrying one
            // here is legitimate and the test above does not forbid it.
            expect(getPlayerHandicapById(player.id)).toBeUndefined()
        }
    })
})
