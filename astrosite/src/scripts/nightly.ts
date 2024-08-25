import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { getPlayerHandicap, withLogin } from '../code/handicaps/teetime-api.ts'

import playersData from '../data/players.json'

const getPlayerById = (id: string, handicapHistory: Array<HandicapHistoryEntry>): Player|undefined => {
    let record = playersData.find((record) => record.id === id) as Player
    if (!record) {
        return undefined
    }
    const handicap = handicapHistory
        .filter(entry => entry.player === id)
        .sort((a,b) => a.date.localeCompare(b.date))
        .map(entry => entry.handicap).pop()
    return { ...record, handicap: record.handicap || handicap }
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

const persistHandicapHistoryToDisk = (players: Player[], handicapHistory: Array<HandicapHistoryEntry>) => {
    const newHandicapChanges: Array<HandicapHistoryEntry> = []
    const date = new Date().toISOString().split('T')[0]

    const playersWithNewHandicap = players
        .filter(p => p.handicap !== undefined)
        .filter(p => p.handicapChanged)

    playersWithNewHandicap.forEach((player) => {
        const duplicate = handicapHistory.find((entry) => entry.player === player.id && entry.date === date)
        if (duplicate) {
            // If our data already contains a handicap entry for this player on this date, let's update
            // the existing entry rather than creating a new one. This might happen when there's been a delay
            // in the Golf Association processing handicaps changes and our early-morning data update has
            // mistakenly grabbed "today's" handicap from the API, and later in the afternoon data update
            // we get the "correct" handicap because the Golf Association has re-run their failed batch job.
            handicapHistory = handicapHistory.filter(entry => !(entry.player === player.id && entry.date === date))
            console.warn(`Updating older entry for ${player.name.first} ${player.name.last} on ${duplicate.date}. Replacing ${JSON.stringify(duplicate.handicap)} with ${JSON.stringify(player.handicap)}`)
        }
        // If there's no entry for this player on this date, we'll just push a new entry to the list
        newHandicapChanges.push({
            date,
            player: player.id,
            handicap: player.handicap as number
        })
    })

    if (newHandicapChanges.length > 0) {
        console.log(`Old handicaps: ${JSON.stringify(handicapHistory, null, 2)}`)
        console.log(`Updated ${newHandicapChanges.length} players' handicap:`)
        console.log(JSON.stringify(newHandicapChanges, null, 2))
        writeFileSync(pathToHandicapHistoryJson, JSON.stringify(handicapHistory.concat(newHandicapChanges), null, 2))
    }
}

// const persistPlayersToDisk = (players: Player[]) => {
//     console.log(`Updated ${players.length} players JSON:`)
//     console.log(JSON.stringify(players, null, 2))
//     writeFileSync(pathToPlayersJson, JSON.stringify(players, null, 2))
// }

const fetchUpdatedPlayerRecords = async (players: Player[], handicapHistory: Array<HandicapHistoryEntry>, token: string): Promise<Player[]> => {
    const playerListPromises = players.map((player: any) => {
        const playerObject = getPlayerById(player.id, handicapHistory)
        if (playerObject && playerObject.club) {
            const oldHandicap = playerObject.handicap  // Let's save the old handicap
            const promiseForNewHandicap = getPlayerHandicap(playerObject.name.first, playerObject.name.last, playerObject.club, token)
            return promiseForNewHandicap.then((newHandicap) => {
                if (newHandicap !== undefined && newHandicap !== oldHandicap) {
                    playerObject.handicap = newHandicap
                    playerObject.handicapChanged = true
                    console.log(`Handicap for ${playerObject.name.first} ${playerObject.name.last} changed from ${oldHandicap} to ${newHandicap}`)
                }
                return Promise.resolve(playerObject)
            }).catch((failure: Error) => {
                console.error(`Failed to fetch handicap for ${playerObject.name.first} ${playerObject.name.last}: ${failure.message}`)
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
        const handicapHistory: Array<HandicapHistoryEntry> = readJsonFile(pathToHandicapHistoryJson, [])
        const updatedPlayers = await fetchUpdatedPlayerRecords(oldPlayers, handicapHistory, token)
        persistHandicapHistoryToDisk(updatedPlayers, handicapHistory)

        // TODO: maybe we should persist the players.json to disk as well, removing any
        // redundant handicap overrides from the file in cases where we're getting a recent
        // handicap for the player from the API? (i.e. we can see that the player's handicap
        // changed between two consecutive API calls)
        // persistPlayersToDisk(removeRedundantHandicapOverrides(oldPlayers, updatedPlayers))
    })
}

updateHandicapsForAllPlayers()