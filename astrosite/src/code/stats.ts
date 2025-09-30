import { type Event, type FinnkampenEvent, type HectorEvent, type MatchplayEvent } from '../schemas/events';
import { type Player } from '../schemas/players';
import { isFinnkampenEvent, isHectorEvent, isMatchplayEvent } from './data'
import { getEventsOfPlayer } from './players';

const didWin = (event: Event, player: Player): boolean => {
    if (isHectorEvent(event)) {
        return didWinHector(event, player) || didWinVictor(event, player)
    } else if (isFinnkampenEvent(event)) {
        return didWinFinnkampen(event, player)
    } else if (isMatchplayEvent(event)) {
        return didWinMatchplay(event, player)
    } else {
        return false
    }
}

const didWinHector = (event: HectorEvent, player: Player): boolean => {
    return !!(event.results?.winners?.hector?.includes(player.id))
}

const didWinVictor = (event: HectorEvent, player: Player): boolean => {
    return !!(event.results?.winners?.victor?.includes(player.id))
}

const didWinFinnkampen = (event: FinnkampenEvent, player: Player): boolean => {
    return !!(event.results?.winners?.finnkampen?.includes(player.id))
}

const didWinMatchplay = (event: MatchplayEvent, player: Player): boolean => {
    return !!(event.results?.winners?.matchplay === player.id)
}

const trophiesFromEvent = (event: Event, player: Player): number => {
    if (isHectorEvent(event)) {
        const hector = didWinHector(event, player) ? 1 : 0
        const victor = didWinVictor(event, player) ? 1 : 0
        return hector + victor
    } else if (isFinnkampenEvent(event)) {
        return didWinFinnkampen(event, player) ? 1 : 0
    } else if (isMatchplayEvent(event)) {
        return didWinMatchplay(event, player) ? 1 : 0
    }
    return 0
}

export function getTotalWinsByPlayer(player: Player): number {
    const appearances = getEventsOfPlayer(player.id)
    const numberOfWins = appearances.map(e => trophiesFromEvent(e, player)).reduce((prev, curr) => prev + curr, 0)
    return numberOfWins
}

export function getHectorWinsByPlayer(player: Player): HectorEvent[] {
    return getEventsOfPlayer(player.id).filter(isHectorEvent).filter(e => didWinHector(e, player))
}

export function getVictorWinsByPlayer(player: Player): HectorEvent[] {
    return getEventsOfPlayer(player.id).filter(isHectorEvent).filter(e => didWinVictor(e, player))
}

export function getMatchplayWinsByPlayer(player: Player): MatchplayEvent[] {
    return getEventsOfPlayer(player.id).filter(isMatchplayEvent).filter(e => didWinMatchplay(e, player))
}

export function getFinnkampenWinsByPlayer(player: Player): FinnkampenEvent[] {
    return getEventsOfPlayer(player.id).filter(isFinnkampenEvent).filter(e => didWinFinnkampen(e, player))
}

export function getEventsWonByPlayer(player: Player): Event[] {
    return getEventsOfPlayer(player.id).filter(event => didWin(event, player))
}
