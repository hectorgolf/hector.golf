import { expect, describe, it } from 'vitest'
import { fetchUpdatedPlayerRecords } from '../../src/workflows/update-handicaps'
import type { HandicapSource, GolfClub } from '../../src/code/handicaps/handicap-source-api'
import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import { playersData } from '../../src/code/data'

/**
 * What `persistHandicapHistoryToDisk` is handed.
 *
 * The writer itself does disk I/O and is not tested, but it makes no decisions:
 * it writes an entry for every player carrying `handicapChanged`, using
 * `handicap` as the value and `handicapChangedFrom` for the commit message. Every
 * one of those decisions is made here, so this is where they are pinned.
 *
 * `fetchUpdatedPlayerRecords` resolves each id against the committed player files,
 * so the ids below are real ones. `simo-l` and `pekka-s` have a club; `ricke-b`
 * has none.
 */

/**
 * A source's answers, written here keyed by player id and translated to the names
 * the source is actually asked about. Keyed by id so that renaming a player in the
 * data cannot quietly turn a test into one that asserts nothing.
 */
const nameOf = (id: string): string => {
    const player = playersData.find((p) => p.id === id)
    if (!player) throw new Error(`No player with id ${id} in the committed data`)
    return `${player.name.first} ${player.name.last}`
}

/** A source that answers from a lookup table, and records what it was asked. */
const sourceReturning = (
    name: string,
    handicapsById: Record<string, number | undefined>,
): HandicapSource & { asked: string[] } => {
    const byName = new Map(Object.entries(handicapsById).map(([id, handicap]) => [nameOf(id), handicap]))
    const asked: string[] = []
    return {
        name,
        asked,
        async getPlayerHandicap(firstName: string, lastName: string): Promise<number | undefined> {
            asked.push(`${firstName} ${lastName}`)
            return byName.get(`${firstName} ${lastName}`)
        },
        async resolveClubMembership(): Promise<GolfClub[]> {
            return []
        },
        async getClubs(): Promise<GolfClub[]> {
            return []
        },
    }
}

/** A source that is down, the way WiseGolf is when its login fails. */
const brokenSource = (name: string): HandicapSource => ({
    name,
    async getPlayerHandicap(): Promise<number | undefined> {
        throw new Error(`${name} is unavailable`)
    },
    async resolveClubMembership(): Promise<GolfClub[]> {
        return []
    },
    async getClubs(): Promise<GolfClub[]> {
        return []
    },
})

const playerRef = (id: string) => ({ id }) as Player

/** Fixes a player's "old" handicap, which is read from the history, not the file. */
const history = (entries: Array<[string, string, number]>): HandicapHistoryEntry[] =>
    entries.map(([player, date, handicap]) => ({ player, date, handicap }))

const run = (ids: string[], sources: HandicapSource[], entries: HandicapHistoryEntry[] = []) =>
    fetchUpdatedPlayerRecords(ids.map(playerRef), entries, sources)

describe('the payload handed to persistHandicapHistoryToDisk', () => {
    it('marks a player whose handicap moved, and says what it moved from', async () => {
        const [simo] = await run(
            ['simo-l'],
            [sourceReturning('Test', { 'simo-l': 7.4 })],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicapChanged).toBe(true)
        expect(simo.handicap).toBe(7.4)
        expect(simo.handicapChangedFrom).toBe(6.1)
    })

    it('leaves a player whose handicap is the same unmarked, so nothing is written', async () => {
        // The reason handicaps.json does not gain 41 entries twice a day.
        const [simo] = await run(
            ['simo-l'],
            [sourceReturning('Test', { 'simo-l': 6.1 })],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicapChanged).toBeUndefined()
        expect(simo.handicap).toBe(6.1)
    })

    it('leaves a player the source has never heard of unmarked', async () => {
        const [simo] = await run(
            ['simo-l'],
            [sourceReturning('Test', {})],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicapChanged).toBeUndefined()
        expect(simo.handicap).toBe(6.1)
    })

    it('leaves every player unmarked when the sources are down', async () => {
        // A WiseGolf outage must not rewrite or erase anything.
        const [simo] = await run(
            ['simo-l'],
            [brokenSource('WiseGolf')],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicapChanged).toBeUndefined()
        expect(simo.handicap).toBe(6.1)
    })

    it('never asks about a player with no club, and never marks them', async () => {
        const source = sourceReturning('Test', {})
        const [ricke] = await run(['ricke-b'], [source])

        expect(source.asked).toEqual([])
        expect(ricke.handicapChanged).toBeUndefined()
    })

    it('carries a scratch handicap of 0 rather than dropping it', async () => {
        const [simo] = await run(
            ['simo-l'],
            [sourceReturning('Test', { 'simo-l': 0 })],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicapChanged).toBe(true)
        expect(simo.handicap).toBe(0)
    })

    it('reports each player independently', async () => {
        const payload = await run(
            ['simo-l', 'pekka-s'],
            [sourceReturning('Test', { 'simo-l': 7.4, 'pekka-s': 17.2 })],
            history([
                ['simo-l', '2026-09-12', 6.1],
                ['pekka-s', '2026-09-12', 17.2],
            ]),
        )
        const changed = payload.filter((p) => p.handicapChanged).map((p) => p.id)

        expect(changed).toEqual(['simo-l'])
    })
})

describe('falling back between sources', () => {
    it('tries the first source in the list first', async () => {
        // The implementation reverses the list and pops, which lands on the first
        // one. Pinned because reading it does not make that obvious.
        const first = sourceReturning('First', { 'simo-l': 7.4 })
        const second = sourceReturning('Second', { 'simo-l': 9.9 })

        const [simo] = await run(['simo-l'], [first, second], history([['simo-l', '2026-09-12', 6.1]]))

        expect(simo.handicap).toBe(7.4)
        expect(second.asked).toEqual([])
    })

    it('falls through to the next source when the first one fails', async () => {
        const fallback = sourceReturning('Fallback', { 'simo-l': 9.9 })

        const [simo] = await run(
            ['simo-l'],
            [brokenSource('Broken'), fallback],
            history([['simo-l', '2026-09-12', 6.1]]),
        )

        expect(simo.handicap).toBe(9.9)
        expect(simo.handicapChanged).toBe(true)
    })
})
