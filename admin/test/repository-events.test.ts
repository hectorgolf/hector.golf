import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deleting is the one operation here that cannot be corrected by repeating it
 * with better input, so what it refuses to do matters more than what it does.
 * The guard is a read before the write: the admin owns matchplay and nothing
 * else in the `events` collection, and the other formats there are mirrors that
 * scheduled jobs write. Deleting one of those would be undone on the next tick
 * at best, and published to the public site as a hole at worst.
 */

const stored = new Map<string, { doc: string }>()
const deleted: string[] = []

function document(id: string, format: string, name: string) {
    return {
        id,
        format,
        name,
        location: 'Finland',
        timing: { start: '2027-05-01', end: '2027-09-01' },
        participants: [],
        status: 'signup',
    }
}

vi.mock('../src/lib/firestore.ts', () => ({
    firestore: () => ({
        collection: () => ({
            doc: (id: string) => ({
                get: async () => ({ exists: stored.has(id), data: () => stored.get(id) }),
                delete: async () => {
                    deleted.push(id)
                    stored.delete(id)
                },
            }),
        }),
    }),
}))

const { deleteMatchplayEvent } = await import('../src/lib/repository/events.ts')

beforeEach(() => {
    stored.clear()
    deleted.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stored.set('HECTORMATCHPLAY2027', { doc: JSON.stringify(document('HECTORMATCHPLAY2027', 'matchplay', 'Matchplay 2027')) })
    stored.set('HECTOR2027', { doc: JSON.stringify(document('HECTOR2027', 'hector', 'Hector 2027')) })
})

describe('deleting a matchplay tournament', () => {
    it('removes the one it was asked for', async () => {
        expect(await deleteMatchplayEvent('HECTORMATCHPLAY2027', 'me@example.com')).toBe(true)
        expect(deleted).toEqual(['HECTORMATCHPLAY2027'])
        expect(stored.has('HECTORMATCHPLAY2027')).toBe(false)
    })

    it('leaves a mirrored event of another format alone', async () => {
        expect(await deleteMatchplayEvent('HECTOR2027', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
        expect(stored.has('HECTOR2027')).toBe(true)
    })

    it('reports an id that is not there rather than deleting nothing quietly', async () => {
        expect(await deleteMatchplayEvent('NOSUCHTHING', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
    })

    it('records who did it, that being the only provenance a deletion leaves', async () => {
        const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
        await deleteMatchplayEvent('HECTORMATCHPLAY2027', 'me@example.com')

        const line = logged.mock.calls.flat().join(' ')
        expect(line).toContain('me@example.com')
        expect(line).toContain('HECTORMATCHPLAY2027')
    })
})
