import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from './types';
import { type Player } from '@hector/schemas/src/players.ts'
import { getAllPlayers, getPlayerName, getPlayerAliases } from '../../code/players'
import { splitCompetitorNames, throughLabel } from './presentation'
import { snapshot } from '../data-source.ts'

// Re-exported so the many existing importers keep a single place to reach for it.
export { leaderboardPosition } from './presentation'


export type EnrichedLeaderboardEntry = {
    description: string;
    players: Array<Player>;
    points: number;
    diff: string;
    through: string;
}

export type EnrichedLeaderboard = Array<EnrichedLeaderboardEntry>

/**
 * Every leaderboard, keyed by the event it belongs to.
 *
 * This used to be `import.meta.glob` over `../../data/leaderboards/*.json`,
 * which returned paths rather than contents and meant the event ids were
 * recovered by stripping `.json` off a filename. The records carry their own
 * `event` id, so the id is now read rather than parsed out of a path.
 */
const leaderboards = new Map<string, Record<string, any>>(
    (await snapshot()).leaderboards
        .map((record) => record as Record<string, any>)
        .filter((record) => typeof record.event === 'string')
        .map((record) => [record.event as string, record])
)

export const getEventsWithLeaderboards = (): Array<string> => {
    return [...leaderboards.keys()]
}

export type HectorEventLeaderboard = {
    hector?: EnrichedLeaderboard,
    victor?: EnrichedLeaderboard,
    updatedAt?: string,
    scoring?: {
        hector: 'ascending' | 'descending',
        victor: 'ascending' | 'descending'
    }
}

export const getLeaderboardsByEventId = (id: string): HectorEventLeaderboard => {
    const record = leaderboards.get(id)
    if (record) {
        // `updatedAt` is still the marker for a usable board rather than a
        // half-written one, exactly as when these were files: `update-leaderboards`
        // writes it last.
        if (record.updatedAt) {
            const enriched = { ...record }
            enriched.hector = enriched.hector ? enrichLeaderboard(enriched.hector) : undefined
            enriched.victor = enriched.victor ? enrichLeaderboard(enriched.victor) : undefined
            return enriched as HectorEventLeaderboard
        } else {
            console.warn(`Leaderboard for ${id} is missing the 'updatedAt' field:\n${JSON.stringify(record, null, 2)}`)
        }
    }
    return { hector: undefined, victor: undefined, updatedAt: undefined, scoring: undefined }
}

const playersByName: {[name:string]: Player} = {}
getAllPlayers().forEach((player) => {
    playersByName[getPlayerName(player)] = player
    playersByName[getPlayerName({ ...player, privacy: undefined })] = player
    getPlayerAliases(player, true).forEach(alias => { playersByName[alias] = player })
})

const playerNameToPlayer = (name: string): Player => {
    return playersByName[name.trim()]!
}

const enrichLeaderboard = (leaderboard: GoogleSheetTeamLeaderboard|GoogleSheetIndividualLeaderboard): EnrichedLeaderboard => {
    const enrichLeaderboardEntry = (entry: any): EnrichedLeaderboardEntry => {
        const playersString = (entry as any).team || (entry as any).player
        const players: Array<Player> = splitCompetitorNames(playersString).map(playerNameToPlayer).filter((p: Player|undefined) => !!p)
        const status = throughLabel(entry.through)
        return {
            players,
            description: playersString,
            points: entry.points,
            diff: entry.diff,
            through: status,
        }
    }
    const isTeamLeaderboard = leaderboard.every(entry => typeof((entry as any).team) === 'string')
    if (isTeamLeaderboard) {
        const noResultsYet = leaderboard.every(entry => entry.through.startsWith('0/') || entry.through === '')
        if (noResultsYet) {
            leaderboard = leaderboard.map((entry, index) => ({
                ...entry,
                team: `Team ${index + 1}`,
                diff: index ? '0.0' : '',
                through: '0/6'
            }))
        }
    }

    return leaderboard.filter(entry => !!((entry as any).team || (entry as any).player)).map((entry) => enrichLeaderboardEntry(entry))
}

