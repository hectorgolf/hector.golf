import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { getPlayerHandicap, withLogin } from '../code/handicaps/teetime-api.ts'

import playersData from '../data/players.json'

const getPlayerById = (id: string): Player|undefined => {
    let _record = playersData.find((record) => record.id === id)
    if (!_record) {
        return undefined
    }
    return _record as Player
}

const readJsonFile = (pathToJsonFile: string, defaultValue: any = []): any => {
    try {
        const content = readFileSync(pathToJsonFile, 'utf-8').toString()
        return JSON.parse(content);
    } catch (err) {
        console.error(`Error reading JSON file ${pathToJsonFile} (${err}) - returning ${JSON.stringify(defaultValue)}`)
        return defaultValue
    }
}

// Get the resolved path to this file and determine the directory from that
// (__dirname is not available in ES6 modules)
const __filename = fileURLToPath(import.meta.url)
const pathToPlayersJson = join(dirname(__filename), '../data/players.json')
const pathToHandicapHistoryJson = join(dirname(__filename), '../data/handicaps.json')

type Player = {
    id: string,
    name: {
        first: string,
        last: string
    },
    contact: {
        phone: string
    },
    image?: string,
    club?: string,
    handicap?: number,
    handicapChanged?: boolean,
}

type HandicapHistoryEntry = {
    date: string,
    player: string,
    handicap: number,
}

const persistHandicapHistoryToDisk = (players: Player[]) => {
    const handicapHistory: Array<HandicapHistoryEntry> = readJsonFile(pathToHandicapHistoryJson, [])
    const handicapChanges: Array<HandicapHistoryEntry> = []
    const date = new Date().toISOString().split('T')[0]

    const playersWithNewHandicap = players
        .filter(p => p.handicap !== undefined)
        .filter(p => p.handicapChanged)

    playersWithNewHandicap.forEach((player) => {
        const isDuplicate = !!handicapHistory.find((entry) => entry.player === player.id && entry.date === date)
        if (!isDuplicate) {
            handicapChanges.push({
                date,
                player: player.id,
                handicap: player.handicap as number
            })
        }
    })

    if (handicapChanges.length > 0) {
        console.log(`Old handicaps: ${JSON.stringify(handicapHistory, null, 2)}`)
        console.log(`Updated ${handicapChanges.length} players' handicap:`)
        console.log(JSON.stringify(handicapChanges, null, 2))
        writeFileSync(pathToHandicapHistoryJson, JSON.stringify(handicapHistory.concat(handicapChanges), null, 2))
    }
}

// const persistPlayersToDisk = (players: Player[]) => {
//     console.log(`Updated ${players.length} players JSON:`)
//     console.log(JSON.stringify(players, null, 2))
//     writeFileSync(pathToPlayersJson, JSON.stringify(players, null, 2))
// }

const fetchUpdatedPlayerRecords = async (players: Player[], token: string): Promise<Player[]> => {
    const playerListPromises = players.map((player: any) => {
        const playerObject = getPlayerById(player.id)
        if (playerObject && playerObject.club) {
            const oldHandicap = player.handicap  // Let's save the old handicap
            const promiseForNewHandicap = getPlayerHandicap(playerObject.name.first, playerObject.name.last, playerObject.club, token)
            return promiseForNewHandicap.then((newHandicap) => {
                if (newHandicap && newHandicap !== oldHandicap) {
                    playerObject.handicap = newHandicap
                    playerObject.handicapChanged = true
                    console.log(`Handicap for ${playerObject.name.first} ${playerObject.name.last} changed from ${oldHandicap} to ${newHandicap}`)
                }
                return Promise.resolve(playerObject)
            })
        } else {
            return Promise.resolve(player)
        }
    })
    return Promise.all(playerListPromises)
}

const updateHandicapsForAllPlayers = () => {
    const oldPlayers = readJsonFile(pathToPlayersJson, [])
    console.log(`Attempting to update handicap data for ${oldPlayers.length} players...`)
    withLogin(async (token: string) => {
        console.log(`Logged in with token: ${token}`)
        const updatedPlayers = await fetchUpdatedPlayerRecords(oldPlayers, token)
        persistHandicapHistoryToDisk(updatedPlayers)

        // TODO: maybe we should persist the players.json to disk as well, removing any
        // redundant handicap overrides from the file in cases where we're getting a recent
        // handicap for the player from the API? (i.e. we can see that the player's handicap
        // changed between two consecutive API calls)
        // persistPlayersToDisk(removeRedundantHandicapOverrides(oldPlayers, updatedPlayers))
    })
}

updateHandicapsForAllPlayers()