import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventFormat, type Event } from '@hector/schemas/src/events.ts'

/**
 * Writing an event, and refusing to write one the admin only mirrors.
 *
 * Both halves used to be safe by construction: `saveMatchplayEvent` took a
 * `MatchplayEvent` and `deleteMatchplayEvent` checked for a format literal, so
 * the type system and one `===` did the work. Step 0 of
 * `docs/plans/authoring-players-and-events.md` widened both to every format,
 * which gives that up — so these are the tests that buy it back. The refusal is
 * the ownership rule expressed as code rather than as a document, and it is now
 * the only thing standing between a page written for Hector events and a write
 * the next `npm run seed` silently reverts.
 */

const stored = new Map<string, { doc: string; updatedBy?: string }>()
const deleted: string[] = []

function document(id: string, format: string, name: string) {
    return {
        id,
        format,
        name,
        location: 'Finland',
        timing: { start: '2027-05-01', end: '2027-09-01' },
        participants: [],
        ...(format === EventFormat.Matchplay ? { status: 'signup' } : {}),
    }
}

vi.mock('../src/lib/firestore.ts', () => ({
    firestore: () => ({
        collection: () => ({
            doc: (id: string) => ({
                get: async () => ({ exists: stored.has(id), data: () => stored.get(id) }),
                set: async (record: { doc: string; updatedBy: string }) => {
                    stored.set(id, record)
                },
                delete: async () => {
                    deleted.push(id)
                    stored.delete(id)
                },
            }),
        }),
    }),
}))

const { NotOwnedError, deleteEvent, saveEvent } = await import('../src/lib/repository/events.ts')

beforeEach(() => {
    stored.clear()
    deleted.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stored.set('HECTORMATCHPLAY2027', {
        doc: JSON.stringify(document('HECTORMATCHPLAY2027', 'matchplay', 'Matchplay 2027')),
    })
    stored.set('HECTOR2027', { doc: JSON.stringify(document('HECTOR2027', 'hector', 'Hector 2027')) })
})

const matchplay = document('HECTORMATCHPLAY2028', 'matchplay', 'Matchplay 2028') as unknown as Event
const hector = document('HECTOR2028', 'hector', 'Hector 2028') as unknown as Event

describe('saving an event', () => {
    it('writes one of a format the admin authors', async () => {
        await saveEvent(matchplay, 'me@example.com')

        const written = stored.get('HECTORMATCHPLAY2028')!
        expect(JSON.parse(written.doc).name).toBe('Matchplay 2028')
        expect(written.updatedBy).toBe('me@example.com')
    })

    /**
     * The one that matters. Firestore would take this write happily and the next
     * seed would revert it within hours, leaving the person who made the edit
     * unable to tell that from never having pressed the button.
     */
    it('refuses a mirrored format rather than writing something the seed reverts', async () => {
        await expect(saveEvent(hector, 'me@example.com')).rejects.toBeInstanceOf(NotOwnedError)
        expect(stored.has('HECTOR2028')).toBe(false)
    })

    it('says which format it refused, since the page shows the message', async () => {
        await expect(saveEvent(hector, 'me@example.com')).rejects.toThrow(/hector/)
    })

    /**
     * Through the discriminated union rather than one format's schema, so the
     * option is picked by `format` and a widened save did not widen what counts
     * as a valid event.
     */
    it('still validates, so the admin cannot store a malformed event', async () => {
        const broken = { ...matchplay, timing: { start: 'the first of May', end: '2027-09-01' } } as Event
        await expect(saveEvent(broken, 'me@example.com')).rejects.toThrow()
        expect(stored.has('HECTORMATCHPLAY2028')).toBe(false)
    })
})

describe('deleting an event', () => {
    it('removes the one it was asked for', async () => {
        expect(await deleteEvent('HECTORMATCHPLAY2027', 'me@example.com')).toBe(true)
        expect(deleted).toEqual(['HECTORMATCHPLAY2027'])
        expect(stored.has('HECTORMATCHPLAY2027')).toBe(false)
    })

    it('leaves a mirrored event of another format alone', async () => {
        expect(await deleteEvent('HECTOR2027', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
        expect(stored.has('HECTOR2027')).toBe(true)
    })

    it('reports an id that is not there rather than deleting nothing quietly', async () => {
        expect(await deleteEvent('NOSUCHTHING', 'me@example.com')).toBe(false)
        expect(deleted).toEqual([])
    })

    /**
     * False rather than a throw, where `saveEvent` throws: the caller says the
     * same thing about a mirrored id as about one that does not exist, so
     * distinguishing them would cost every call site a catch for no difference.
     */
    it('answers the same way for a mirrored id as for a missing one', async () => {
        expect(await deleteEvent('HECTOR2027', 'me@example.com')).toBe(
            await deleteEvent('NOSUCHTHING', 'me@example.com')
        )
    })

    it('records who did it, that being the only provenance a deletion leaves', async () => {
        const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
        await deleteEvent('HECTORMATCHPLAY2027', 'me@example.com')

        const line = logged.mock.calls.flat().join(' ')
        expect(line).toContain('me@example.com')
        expect(line).toContain('HECTORMATCHPLAY2027')
    })
})
