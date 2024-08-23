import { type Player } from '../schemas/players';
import { getPlayerHandicap as getPlayerHandicapFromAPI } from './handicaps/teetime-api';
import { type HandicapHistoryEntry, schema as HandicapHistoryEntrySchema } from '../schemas/handicaps';
import handicapData from '../data/handicaps.json';


export const getPlayerHandicap = async (player: Player): Promise<number|undefined> => {
    if (player.club) {
        return await getPlayerHandicapFromAPI(player.name.first, player.name.last, player.club);
    }
    return undefined
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
