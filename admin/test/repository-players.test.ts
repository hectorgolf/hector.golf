import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Player } from '@hector/schemas/src/players.ts'

/**
 * Writing a player, which the admin cannot do yet and one flag away can.
 *
 * `savePlayer` and `deletePlayer` have no caller: there is no player editor, and
 * step 1 of `docs/plans/authoring-players-and-events.md` is what builds one.
 * They exist now because the refusal in them is the ownership rule for a
 * collection two scheduled jobs still write, and that rule is cheaper to get
 * right with nothing depending on it than in the middle of an editor.
 *
 * Which makes these tests the only thing exercising them, and the reason both
 * states of `PLAYERS_ARE_OWNED` are covered rather than just today's. The flag
 * is false, so the untested path would otherwise be exactly the one that runs
 * on the day somebody flips it.
 */

const players = new Map<string, { doc: string; updatedBy?: string }>()
const deleted: string[] = []

/** Flipped per test; the mock below reads it through a getter, so it is live. */
let playersAreOwned = false

vi.mock('../src/lib/ownership.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/ownership.ts')>()
    return {
        ...actual,
        get PLAYERS_ARE_OWNED() {
            return playersAreOwned
        },
    }
})

vi.mock('../src/lib/firestore.ts', () => ({
    firestore: () => ({
        collection: () => ({
            doc: (id: string) => ({
                get: async () => ({ exists: players.has(id), data: () => players.get(id) }),
                set: async (record: { doc: string; updatedBy: string }) => {
                    players.set(id, record)
                },
                delete: async () => {
                    deleted.push(id)
                    players.delete(id)
                },
            }),
        }),
    }),
}))

const { NotOwnedError, deletePlayer, savePlayer } = await import('../src/lib/repository/events.ts')

const player = (id = 'lasse-k'): Player => ({
    id,
    name: { first: 'Lasse', last: 'Koskela' },
    contact: { phone: '+358000000000' },
})

beforeEach(() => {
    players.clear()
    deleted.length = 0
    playersAreOwned = false
    vi.spyOn(console, 'log').mockImplementation(() => {})
    players.set('lasse-k', { doc: JSON.stringify(player()), updatedBy: 'seed' })
})

describe('while players are mirrored, which is today', () => {
    it('refuses to save one, rather than writing what the next seed reverts', async () => {
        await expect(savePlayer(player('eero-s'), 'me@example.com')).rejects.toBeInstanceOf(NotOwnedError)
        expect(players.has('eero-s')).toBe(false)
    })

    it('refuses to overwrite a player the seed put there', async () => {
        await expect(savePlayer(player(), 'me@example.com')).rejects.toBeInstanceOf(NotOwnedError)
        expect(players.get('lasse-k')?.updatedBy).toBe('seed')
    })

    it('answers false to a delete, the same as `deleteEvent` does for a mirrored format', async () => {
        expect(await deletePlayer('lasse-k', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
        expect(players.has('lasse-k')).toBe(true)
    })
})

describe('once the flag flips and the admin owns players', () => {
    beforeEach(() => {
        playersAreOwned = true
    })

    it('writes the player, stamped with who did it', async () => {
        await savePlayer(player('eero-s'), 'me@example.com')

        const written = players.get('eero-s')!
        expect(JSON.parse(written.doc).id).toBe('eero-s')
        expect(written.updatedBy).toBe('me@example.com')
    })

    /**
     * The same schema the seed validates with, so a record the admin writes
     * cannot be one the seed would have refused to import.
     */
    it('validates, so the admin cannot store a malformed player', async () => {
        const broken = { ...player('eero-s'), name: { first: 'Eero' } } as unknown as Player
        await expect(savePlayer(broken, 'me@example.com')).rejects.toThrow()
        expect(players.has('eero-s')).toBe(false)
    })

    it('deletes a player who is there', async () => {
        expect(await deletePlayer('lasse-k', 'me@example.com')).toBe(true)
        expect(deleted).toEqual(['lasse-k'])
    })

    it('reports an id that is not there rather than deleting nothing quietly', async () => {
        expect(await deletePlayer('nobody', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
    })

    it('records who did it, that being the only provenance a deletion leaves', async () => {
        const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
        await deletePlayer('lasse-k', 'me@example.com')

        const line = logged.mock.calls.flat().join(' ')
        expect(line).toContain('me@example.com')
        expect(line).toContain('lasse-k')
    })
})
