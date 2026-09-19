import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'

/**
 * Reading one event of a named format, and one player.
 *
 * The narrowing is the behaviour worth pinning. `getEventOfFormat` answers
 * undefined for an id of the wrong format exactly as it does for an id that is
 * not there — the pages under `/events/hector/` and `/events/finnkampen/` both
 * rely on that, and without it a Hector id typed into the Finnkampen route would
 * render a page of the wrong shape rather than a 404. `deleteMatchplayEvent`
 * already depended on the same guard when it was a format literal; this is that
 * guard generalised, so it is checked for a format other than matchplay too.
 */

const events = new Map<string, { doc: string }>()
const players = new Map<string, { doc: string }>()

const collections: Record<string, Map<string, { doc: string }>> = { events, players }

vi.mock('../src/lib/firestore.ts', () => ({
    firestore: () => ({
        collection: (name: string) => {
            const store = collections[name]!
            return {
                doc: (id: string) => ({
                    get: async () => ({ exists: store.has(id), data: () => store.get(id) }),
                }),
                get: async () => ({
                    docs: [...store.entries()].map(([id, data]) => ({ id, data: () => data })),
                }),
            }
        },
    }),
}))

const { getEventOfFormat, getPlayer, listEventsOfFormat, listPlayers } = await import(
    '../src/lib/repository/events.ts'
)

function event(id: string, format: string, start: string) {
    return {
        id,
        format,
        name: `${format} ${id}`,
        location: 'Finland',
        timing: { start, end: start },
        participants: [],
    }
}

beforeEach(() => {
    events.clear()
    players.clear()
    for (const [id, format, start] of [
        ['HECTOR2025', 'hector', '2025-09-25'],
        ['HECTOR2026', 'hector', '2026-09-24'],
        ['FINNKAMPEN2022', 'finnkampen', '2022-10-22'],
        ['HECTORMATCHPLAY2026', 'matchplay', '2026-01-01'],
    ] as const) {
        events.set(id, { doc: JSON.stringify(event(id, format, start)) })
    }
    players.set('lasse-k', {
        doc: JSON.stringify({
            id: 'lasse-k',
            name: { first: 'Lasse', last: 'Koskela' },
            contact: { phone: '+358000000000' },
        }),
    })
})

describe('reading one event of a named format', () => {
    it('returns the event when the format is the one asked for', async () => {
        const found = await getEventOfFormat('HECTOR2025', EventFormat.Hector)
        expect(found?.id).toBe('HECTOR2025')
    })

    it('refuses an id of another format, the same as one that is not there', async () => {
        expect(await getEventOfFormat('HECTORMATCHPLAY2026', EventFormat.Hector)).toBeUndefined()
        expect(await getEventOfFormat('HECTOR2025', EventFormat.Finnkampen)).toBeUndefined()
        expect(await getEventOfFormat('NOSUCHTHING', EventFormat.Hector)).toBeUndefined()
    })
})

describe('listing the events of one format', () => {
    it('leaves the other formats where they are', async () => {
        expect((await listEventsOfFormat(EventFormat.Hector)).map((e) => e.id)).toEqual([
            'HECTOR2026',
            'HECTOR2025',
        ])
        expect((await listEventsOfFormat(EventFormat.Finnkampen)).map((e) => e.id)).toEqual([
            'FINNKAMPEN2022',
        ])
    })

    it('keeps the newest-first order the whole collection is read in', async () => {
        const starts = (await listEventsOfFormat(EventFormat.Hector)).map((e) => e.timing.start)
        expect(starts).toEqual([...starts].sort().reverse())
    })
})

describe('reading one player', () => {
    it('finds the document rather than scanning the collection', async () => {
        expect((await getPlayer('lasse-k'))?.name.last).toBe('Koskela')
    })

    it('answers undefined for an id nothing has, which the page renders as a 404', async () => {
        expect(await getPlayer('jussi-allonen-hcp070')).toBeUndefined()
    })

    it('still lists the whole collection for the pages that need names', async () => {
        expect((await listPlayers()).map((p) => p.id)).toEqual(['lasse-k'])
    })
})
