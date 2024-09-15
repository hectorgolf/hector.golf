import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from './types';
import { type Player } from '../../schemas/players'
import { getAllPlayers, getPlayerName, getPlayerAliases } from '../../code/players'


export type EnrichedLeaderboardEntry = {
    description: string,
    players: Array<Player>
    points: number
    diff: string
    through: string
}

export type EnrichedLeaderboard = Array<EnrichedLeaderboardEntry>

const leaderboardFiles = Object.keys(import.meta.glob('../../data/leaderboards/*.json')).map((filepath: string) => {
    return join('src/code/leaderboards', filepath)
})
console.log(`leaderboardFiles: ${JSON.stringify(leaderboardFiles, null, 2)}`)

export const getEventsWithLeaderboards = (): Array<string> => {
    return leaderboardFiles.map((filepath: string) => {
        return filepath.split('/').pop()?.replace('.json', '') || ''
    })
}

export type HectorEventLeaderboard = {
    hector?: EnrichedLeaderboard,
    victor?: EnrichedLeaderboard,
    updatedAt?: string,
}

export const getLeaderboardsByEventId = (id: string): HectorEventLeaderboard => {
    const dataFilePath: string|undefined = leaderboardFiles.find((filepath: string) => filepath.endsWith(`/${id}.json`))
    // const dataFilePath = join(dirname(__filename), `../../data/leaderboards/${id}.json`)
    if (dataFilePath && existsSync(dataFilePath)) {
        const rawData = JSON.parse(readFileSync(dataFilePath, 'utf8'))
        if (rawData.updatedAt) {
            rawData.hector = rawData.hector ? enrichLeaderboard(rawData.hector) : undefined
            rawData.victor = rawData.victor ? enrichLeaderboard(rawData.victor) : undefined
            return rawData as HectorEventLeaderboard
        } else {
            console.warn(`Leaderboard data file ${dataFilePath} is missing the 'updatedAt' field:\n${JSON.stringify(rawData, null, 2)}`)
        }
    }
    return { hector: undefined, victor: undefined, updatedAt: undefined }
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
    const isFinished = (through: string): boolean => {
        if (through && through.match(/^\d+\/\d+$/)) {
            const [ howMany, outOfHowMany] = through.split('/')
            return howMany === outOfHowMany
        }
        return false
    }
    const enrichLeaderboardEntry = (entry: any) => {
        const playersString = (entry as any).team || (entry as any).player
        const players: Array<Player> = playersString.split('+').map(playerNameToPlayer).filter((p: Player|undefined) => !!p)
        const status = isFinished(entry.through) ? 'F' : (entry.through || '0')
        return {
            players,
            description: playersString,
            points: entry.points,
            diff: entry.diff,
            through: status
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
