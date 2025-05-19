import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import type { HandicapSource } from '../code/handicaps/handicap-source-api.ts'
import { createTeetimeSession } from '../code/handicaps/teetime-api.ts'
import { createWisegolfSession } from '../code/handicaps/wisegolf-api.ts'

import { isoDateToday } from '../code/dates.ts'

import { playersData, hectorEvents, hasParticipants, isUpcomingEvent, pathToEventJson } from '../code/data.ts'
import { getPlayerName, updatePlayerData } from '../code/players.ts'


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
const pathToHandicapHistoryJson = join(dirname(__filename), '../data/handicaps.json')
const pathToHandicapUpdateCommitMessage = join(dirname(__filename), '../../.update-handicaps-commit')

if (existsSync(pathToHandicapUpdateCommitMessage)) {
    console.log(`Deleting pre-existing commit message file: ${resolve(pathToHandicapUpdateCommitMessage)}`)
    rmSync(pathToHandicapUpdateCommitMessage, { force: true })
} else {
    console.log(`Creating an empty commit message file: ${resolve(pathToHandicapUpdateCommitMessage)}`)
}
writeFileSync(pathToHandicapUpdateCommitMessage, '')

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
    handicapChangedFrom?: number,
}

type HandicapHistoryEntry = {
    date: string,
    player: string,
    handicap: number,
}

const persistHandicapHistoryToDisk = async (players: Player[], handicapHistory: Array<HandicapHistoryEntry>) => {
    const newHandicapChanges: Array<HandicapHistoryEntry> = []
    const date = isoDateToday()

    const playersWithNewHandicap = players
        .filter(p => p.handicap !== undefined)
        .filter(p => p.handicapChanged)

    const commitMessage: string[] = []

    for (const player of playersWithNewHandicap) {
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
            handicap: player.handicap as number,
        })

        commitMessage.push(`- ${player.name.first} ${player.name.last}: ${JSON.stringify(player.handicapChangedFrom)} -> ${JSON.stringify(player.handicap)}`)

        await updatePlayerData(player)
    }

    if (newHandicapChanges.length > 0) {
        console.log(`Updated ${newHandicapChanges.length} players' handicap:`)
        console.log(JSON.stringify(newHandicapChanges, null, 2))
        writeFileSync(pathToHandicapHistoryJson, JSON.stringify(handicapHistory.concat(newHandicapChanges), null, 2))
        writeFileSync(pathToHandicapUpdateCommitMessage, `Updated ${newHandicapChanges.length} players' handicap:\n${commitMessage.join('\n')}`)
        console.log(`Done updating handicaps.`)
    }
}

const fetchUpdatedPlayerRecords = async (players: Player[], handicapHistory: Array<HandicapHistoryEntry>, handicapSources: Array<HandicapSource>): Promise<Player[]> => {
    const playerListPromises = players.map((player: any) => {
        const playerObject = getPlayerById(player.id, handicapHistory)
        if (playerObject && playerObject.club) {
            const oldHandicap = playerObject.handicap  // Let's save the old handicap

            const fetchFromSources = async (sources: Array<HandicapSource>): Promise<number|undefined> => {
                const source = sources.pop()
                if (!source) {
                    return Promise.reject(`No HandicapSources remaining to try :(`)
                }
                return source.getPlayerHandicap(playerObject.name.first, playerObject.name.last, playerObject.club!)
                    .then(handicap => {
                        if (handicap !== undefined) {
                            const changeMsg = (handicap !== oldHandicap) ? `${JSON.stringify(oldHandicap)} -> ${JSON.stringify(handicap)}` : 'no change'
                            console.log(`Handicap found for ${getPlayerName(playerObject)} from ${source.name} (${changeMsg})`)
                            return Promise.resolve(handicap)
                        } else {
                            return Promise.reject(`No handicap found for ${playerObject.name.first} ${playerObject.name.last} from ${source.name}`)
                        }
                    })
                    .catch(failure => {
                        if (failure.message) console.error(`Failed to fetch handicap for ${playerObject.name.first} ${playerObject.name.last} from ${source.name}: ${failure.message}`)
                        if (sources.length > 0) {
                            return fetchFromSources(sources)
                        } else {
                            return Promise.reject(failure)
                        }
                    })
            }

            const sources = handicapSources.toReversed()
            return fetchFromSources(sources).then(newHandicap => {
                if (newHandicap !== undefined && newHandicap !== oldHandicap) {
                    playerObject.handicap = newHandicap
                    playerObject.handicapChanged = true
                    playerObject.handicapChangedFrom = oldHandicap
                    console.log(`Handicap for ${playerObject.name.first} ${playerObject.name.last} changed from ${oldHandicap} to ${newHandicap}`)
                }
                return Promise.resolve(playerObject)
            }).catch((_: Error) => {
                console.error(`Failed to fetch handicap for ${playerObject.name.first} ${playerObject.name.last} from any of our sources`)
                return Promise.resolve(playerObject)
            })
        } else {
            return Promise.resolve(player)
        }
    })
    return Promise.all(playerListPromises)
}

const updateHandicapsForAllPlayers = async () => {
    console.log(`Attempting to update handicap data for ${playersData.length} players...`)
    const sourcePromises = await Promise.allSettled([createTeetimeSession(), createWisegolfSession()])
    const availableSources = sourcePromises.filter(r => r.status === 'fulfilled').map(r => r.value)
    if (availableSources.length < sourcePromises.length) {
        console.error(`Failed to access all handicap sources. Only ${availableSources.length} out of ${sourcePromises.length} API connections were successfully established.`)
    }
    const handicapHistory: Array<HandicapHistoryEntry> = readJsonFile(pathToHandicapHistoryJson, [])
    const updatedPlayers = await fetchUpdatedPlayerRecords(playersData, handicapHistory, availableSources)
    await persistHandicapHistoryToDisk(updatedPlayers, handicapHistory)
}

type HectorEvent = {
    id: string,
    name: string,
    date: string,
    format: string,
    participants: Array<string>,
    buckets: undefined|Array<Array<{ id: string, handicap: number }>>,
}

const updateBucketsForUpcomingEvents = async () => {
    const handicapHistory: Array<HandicapHistoryEntry> = readJsonFile(pathToHandicapHistoryJson, [])

    console.log(`Updating buckets for upcoming events...`)
    const eventsToUpdate = hectorEvents.filter(hasParticipants).filter(isUpcomingEvent) as HectorEvent[]

    eventsToUpdate.forEach((event) => {
        // Split participants to two buckets
        const participants: Array<Player>|undefined = event.participants
            ?.map(id => getPlayerById(id, handicapHistory))
            ?.filter(p => !!p)
            ?.sort((p1, p2) => p1!.handicap! - p2!.handicap!)
        const trimPlayer = (player: Player): { id: string, handicap: number|undefined } => {
            return { id: player.id, handicap: player.handicap || 0 }
        }
        const bucket1 = participants?.slice(0, Math.ceil(participants.length / 2))?.map(trimPlayer)
        const bucket2 = participants?.slice(bucket1!.length)?.map(trimPlayer)

        // Add the updated buckets to the event object
        const eventObject = hectorEvents.find((e: any) => e.id === event.id)
        if (eventObject) {
            const newBuckets = [ bucket1, bucket2 ]
            const oldBuckets = eventObject.buckets
            if (JSON.stringify(newBuckets) !== JSON.stringify(oldBuckets)) {
                eventObject.buckets = newBuckets
                const filePath = pathToEventJson(eventObject)
                writeFileSync(filePath, JSON.stringify(eventObject, null, 2))
                console.log(`Updated buckets for ${eventObject.name} in ${filePath}`)
            } else {
                console.log(`No changes to buckets for event ${event.id} (${event.name} on ${event.date})`)
            }
        }
    })
    console.log(`Done updating buckets.`)
}

const run = async () => {
    await updateHandicapsForAllPlayers()
    await updateBucketsForUpcomingEvents()
}

run()