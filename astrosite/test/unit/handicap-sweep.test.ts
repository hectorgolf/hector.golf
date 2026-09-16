import { expect, describe, it } from 'vitest'
import { fetchUpdatedPlayerRecords, sweepOf } from '../../src/workflows/update-handicaps'
import type { HandicapSource, GolfClub } from '@hector/wisegolf/src/handicap-source-api.ts'
import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import { playersData } from '../../src/code/data'

/**
 * Whether a sweep *looked* at a player, as opposed to whether it found anything new.
 *
 * The distinction was always drawn — one path logs "no change", the other a failure
 * — and used to be discarded at the end of the run, because only changes were
 * written down. `handicap-checks.json` is where it goes now, and `handicapChecked`
 * is how it gets there, so the quiet sweep is the case worth pinning: it is the one
 * that previously left no trace at all.
 */

const nameOf = (id: string): string => {
    const player = playersData.find((p) => p.id === id)
    if (!player) throw new Error(`No player with id ${id} in the committed data`)
    return `${player.name.first} ${player.name.last}`
}

const sourceReturning = (handicapsById: Record<string, number | undefined>): HandicapSource => {
    const byName = new Map(Object.entries(handicapsById).map(([id, handicap]) => [nameOf(id), handicap]))
    return {
        name: 'test source',
        async getPlayerHandicap(firstName: string, lastName: string): Promise<number | undefined> {
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
const brokenSource = (): HandicapSource => ({
    name: 'broken source',
    async getPlayerHandicap(): Promise<number | undefined> {
        throw new Error('unavailable')
    },
    async resolveClubMembership(): Promise<GolfClub[]> {
        return []
    },
    async getClubs(): Promise<GolfClub[]> {
        return []
    },
})

const playerRef = (id: string) => ({ id }) as Player

const history = (entries: Array<[string, string, number]>): HandicapHistoryEntry[] =>
    entries.map(([player, date, handicap]) => ({ player, date, handicap }))

const run = (ids: string[], sources: HandicapSource[], entries: HandicapHistoryEntry[] = []) =>
    fetchUpdatedPlayerRecords(ids.map(playerRef), entries, sources)

/** `simo-l` and `pekka-s` have a club in the committed data; `ricke-b` has none. */
describe('what a sweep reports about having looked', () => {
    it('marks a player whose handicap has not moved', async () => {
        // The quiet sweep. Nothing is written to the observation log, nothing appears
        // in the commit message, and before the sweep log there was no record that
        // this player had been looked at at all.
        const [simo] = await run(['simo-l'], [sourceReturning({ 'simo-l': 5.9 })], history([['simo-l', '2026-09-01', 5.9]]))
        expect(simo.handicapChanged).toBeFalsy()
        expect(simo.handicapChecked).toBe(true)
    })

    it('marks a player whose handicap moved', async () => {
        const [simo] = await run(['simo-l'], [sourceReturning({ 'simo-l': 6.1 })], history([['simo-l', '2026-09-01', 5.9]]))
        expect(simo.handicapChanged).toBe(true)
        expect(simo.handicapChecked).toBe(true)
    })

    it('does not mark a player every source failed on', async () => {
        const [simo] = await run(['simo-l'], [brokenSource()])
        expect(simo.handicapChecked).toBeFalsy()
    })

    it('does not mark a player with no club, who is never asked about', async () => {
        const [ricke] = await run(['ricke-b'], [sourceReturning({ 'ricke-b': 12.0 })])
        expect(ricke.handicapChecked).toBeFalsy()
    })

    it('tells the two kinds of unswept player apart from the swept ones', async () => {
        const players = await run(
            ['simo-l', 'pekka-s', 'ricke-b'],
            [sourceReturning({ 'simo-l': 5.9, 'pekka-s': undefined })],
            history([['simo-l', '2026-09-01', 5.9]]),
        )
        const skipped = players.filter((p) => !p.handicapChecked).map((p) => p.id)
        // `pekka-s` has a club but no answer; `ricke-b` has no club to ask about.
        // Neither was checked, which is the only thing the sweep log acts on.
        expect(skipped.sort()).toEqual(['pekka-s', 'ricke-b'])
        expect(players.length - skipped.length).toBe(1)
    })
})

describe('what gets written to the sweep log', () => {
    const checked = (id: string) => ({ id, handicapChecked: true }) as Player & { handicapChecked?: boolean }
    const unchecked = (id: string) => ({ id }) as Player & { handicapChecked?: boolean }
    const at = '2026-09-14T03:02:42Z'

    it('counts the checked and names the skipped', () => {
        expect(sweepOf([checked('simo-l'), checked('pekka-s'), unchecked('ricke-b')], at)).toEqual({
            at,
            checked: 2,
            skipped: ['ricke-b'],
        })
    })

    it('records a sweep where nothing changed, which is the whole point', () => {
        expect(sweepOf([checked('simo-l'), checked('pekka-s')], at)).toEqual({ at, checked: 2, skipped: [] })
    })

    it('records nothing at all when no source answered for anyone', () => {
        // An outage would otherwise write the entire roster under `skipped` and commit
        // and deploy the site over a run that learned nothing.
        expect(sweepOf([unchecked('simo-l'), unchecked('ricke-b')], at)).toBeUndefined()
        expect(sweepOf([], at)).toBeUndefined()
    })
})
