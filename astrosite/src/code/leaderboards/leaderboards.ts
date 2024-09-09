import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from './types';

const leaderboardFiles = Object.keys(import.meta.glob('../../data/leaderboards/*.json')).map((filepath: string) => {
    return join('src/code/leaderboards', filepath)
})
console.log(`leaderboardFiles: ${JSON.stringify(leaderboardFiles, null, 2)}`)

export const getEventsWithLeaderboards = (): Array<string> => {
    return leaderboardFiles.map((filepath: string) => {
        return filepath.split('/').pop()?.replace('.json', '') || ''
    })
}

export const getLeaderboardsByEventId = (id: string): { hector: GoogleSheetTeamLeaderboard|undefined, victor: GoogleSheetIndividualLeaderboard|undefined, updatedAt: string|undefined } => {
    const dataFilePath: string|undefined = leaderboardFiles.find((filepath: string) => filepath.endsWith(`/${id}.json`))
    // const dataFilePath = join(dirname(__filename), `../../data/leaderboards/${id}.json`)
    if (dataFilePath && existsSync(dataFilePath)) {
        return JSON.parse(readFileSync(dataFilePath, 'utf8'))
    }
    return { hector: undefined, victor: undefined, updatedAt: undefined }
}