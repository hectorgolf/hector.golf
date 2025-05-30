import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import type { HandicapSource } from '../code/handicaps/handicap-source-api.ts'
import { createTeetimeSession } from '../code/handicaps/teetime-api.ts'
import { createWisegolfSession } from '../code/handicaps/wisegolf-api.ts'

import { pathToPlayerJson, playersData } from '../code/data.ts'
import { getPlayerName } from '../code/players.ts'


const getPlayerById = (id: string): Player|undefined => {
    let record = playersData.find((record) => record.id === id) as Player
    if (!record) {
        return undefined
    }
    return { ...record, handicap: record.handicap }
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
const pathToClubMembershipUpdateCommitMessage = join(dirname(__filename), '../../.identify-clubs-commit')

if (existsSync(pathToClubMembershipUpdateCommitMessage)) {
    console.log(`Deleting pre-existing commit message file: ${resolve(pathToClubMembershipUpdateCommitMessage)}`)
    rmSync(pathToClubMembershipUpdateCommitMessage, { force: true })
} else {
    console.log(`Creating an empty commit message file: ${resolve(pathToClubMembershipUpdateCommitMessage)}`)
}
writeFileSync(pathToClubMembershipUpdateCommitMessage, '')

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
    clubFound?: boolean,
}

const persistPlayersToDisk = (players: Player[]) => {
    if (players.length === 0) {
        console.log(`No new clubs found. Skipping persisting to disk.`)
        return
    }

    const commitMessage: string[] = players.map((player: any) => {
        return `  - ${getPlayerName(player)} was only found from ${player.club}`
    })

    console.log(`Updating ${players.length} players' club membership:`)
    players.forEach((player: Player) => {
        console.log(JSON.stringify(player, null, 4))
        writeFileSync(pathToPlayerJson(player), JSON.stringify(player, null, 4))
    })
    writeFileSync(pathToClubMembershipUpdateCommitMessage, `Updated ${players.length} players' club membership:\n${commitMessage.join('\n')}`)
    console.log(`Done updating club memberships.`)
}

const updatePlayerRecords = async (players: Player[], handicapSources: Array<HandicapSource>): Promise<Player[]> => {
    const playerListPromises = players.map((player: any) => {
        const playerObject = getPlayerById(player.id)
        if (playerObject && !playerObject.club) {
            // Ok. The player does not have a club on record - let's try to find them from all of our sources.
            // We'll only assign a club to a player if there's exactly one club with a member matching our player's name.

            const promises: Array<Promise<string[]>> = []
            for (const source of handicapSources) {
                const foundInClubs = source.resolveClubMembership(playerObject.name.first, playerObject.name.last)
                foundInClubs.then(clubs => console.log(`${getPlayerName(playerObject)} found at ${clubs.length} clubs via ${source.name}: ${JSON.stringify(clubs.sort())}`))
                promises.push(foundInClubs)
            }
            return Promise.all(promises)
                .then(clubs => clubs.flat())
                .then(clubs => [...new Set(clubs)].sort())
                .then(clubs => {
                    if (clubs.length === 1) {
                        return clubs[0]
                    } else {
                        return undefined
                    }
                }).then(club => {
                    if (club) {
                        playerObject.club = club
                        console.log(`Club found for ${playerObject.name.first} ${playerObject.name.last}: ${playerObject.club}`)
                    }
                    return Promise.resolve(playerObject)
                }).catch((_: Error) => {
                    console.error(`Failed to find club for ${playerObject.name.first} ${playerObject.name.last} from any of our sources`)
                    return Promise.resolve(playerObject)
                });
        } else {
            return Promise.resolve(player)
        }
    })
    return Promise.all(playerListPromises)
}

const updateHandicapsForAllPlayers = async () => {
    const oldPlayers = playersData
    const playersWithoutClub = oldPlayers.filter((player: any) => !player.club)
    if (playersWithoutClub.length > 0) {
        console.log(`Attempting to identify club for ${playersWithoutClub.length} players...`)
        const sources = await Promise.all([createTeetimeSession(), createWisegolfSession()])
        const attemptedPlayers = await updatePlayerRecords(playersWithoutClub, sources)
        const updatedPlayers = attemptedPlayers.filter((player: any) => !!player.club)
        if (updatedPlayers.length > 0) {
            console.log(`Found clubs for ${updatedPlayers.length} players. Persisting to disk...`)
            persistPlayersToDisk(updatedPlayers)
        } else {
            console.log(`No new clubs found. Skipping persisting to disk.`)
        }
    } else {
        console.log(`All players have a club identified. Skipping club membership update.`)
    }
}


const run = async () => {
    await updateHandicapsForAllPlayers()
}

run()