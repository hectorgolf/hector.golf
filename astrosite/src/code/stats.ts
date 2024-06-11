import { type Event } from '../schemas/events';
import { getAllEvents } from './events';

import { type Player, schema as PlayerSchema } from '../schemas/players';
import { getAllPlayers, getPlayerById, getEventsOfPlayer, getPlayersAtEvent } from './players';


export function getTotalWinsByPlayer(player: Player): number {
    const didWin = (event: Event): boolean => !!(event.results?.winners?.hector?.includes(player.id))
    const appearances = getEventsOfPlayer(player.id)
    const numberOfWins = appearances.map(didWin).reduce((prev, curr) => prev + (curr ? 1 : 0), 0)
    return numberOfWins
}

export function getEventsWonByPlayer(player: Player): Event[] {
    const didWin = (event: Event): boolean => !!(event.results?.winners?.hector?.includes(player.id))
    const events = getEventsOfPlayer(player.id)
    return events.filter(didWin)
}
