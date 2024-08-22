import { type Player } from '../schemas/players';
import { getPlayerHandicap as getPlayerHandicapFromAPI } from './handicaps/teetime-api';


export const getPlayerHandicap = async (player: Player): Promise<number|undefined> => {
    if (player.club) {
        return await getPlayerHandicapFromAPI(player.name.first, player.name.last, player.club);
    }
    return undefined
}
