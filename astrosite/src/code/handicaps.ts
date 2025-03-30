import { type Player } from '../schemas/players'
import { type HandicapSource } from './handicaps/handicap-source-api'
import { type HandicapHistoryEntry, schema as HandicapHistoryEntrySchema } from '../schemas/handicaps'
import { createTeetimeSession } from './handicaps/teetime-api'
import { createWisegolfSession } from './handicaps/wisegolf-api'

import handicapData from '../data/handicaps.json'

function createSources(): Promise<HandicapSource[]> {
    return Promise.all([
        createWisegolfSession(),
        createTeetimeSession(),
    ])
}

export const getPlayerHandicap = async (player: Player): Promise<number|undefined> => {
    let hcp: number|undefined = undefined
    if (player.club) {
        const sources = await createSources()
        for (let i=0; i < sources.length && hcp === undefined; i++) {
            hcp = await sources[i].getPlayerHandicap(player.name.first, player.name.last, player.club)
        }
    }
    return hcp
}

export const getPlayerHandicapHistory = (player: Player): HandicapHistoryEntry[] => {
    return getPlayerHandicapHistoryById(player.id)
}

export const getPlayerHandicapHistoryById = (id: string): HandicapHistoryEntry[] => {
    let events: HandicapHistoryEntry[] = handicapData
        .map(record => HandicapHistoryEntrySchema.parse(record))
        .filter(event => event.player === id)
    return events.sort((a, b) => a.date.localeCompare(b.date))
}
