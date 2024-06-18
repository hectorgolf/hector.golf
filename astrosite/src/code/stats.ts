import { type Event, type FinnkampenEvent, type HectorEvent, type MatchplayEvent } from '../schemas/events';
import { type Player } from '../schemas/players';
import { getEventsOfPlayer } from './players';

const didWin = (event: Event, player: Player): boolean => {
    if (event.format === 'hector') {
        return !!((event as HectorEvent).results?.winners?.hector?.includes(player.id))
    } else if (event.format === 'finnkampen') {
        return !!((event as FinnkampenEvent)).results?.winners?.finnkampen?.includes(player.id)
    } else if (event.format === 'matchplay') {
        return !!((event as MatchplayEvent).results?.winners?.matchplay === player.id)
    } else {
        return false
    }
}

export function getTotalWinsByPlayer(player: Player): number {
    const appearances = getEventsOfPlayer(player.id)
    const numberOfWins = appearances.map(e => didWin(e, player)).reduce((prev, curr) => prev + (curr ? 1 : 0), 0)
    return numberOfWins
}

export function getEventsWonByPlayer(player: Player): Event[] {
    const events = getEventsOfPlayer(player.id)
    return events.filter(event => didWin(event, player))
}
