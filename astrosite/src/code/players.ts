import { type Event, type HectorEvent, type MatchplayEvent, type FinnkampenEvent } from '../schemas/events';
import { getAllEvents } from './events';

import playersData from '../data/players.json';
import { type Player, schema as PlayerSchema } from '../schemas/players';

import { type HandicapHistoryEntry } from '../schemas/handicaps';
import { getPlayerHandicapHistoryById as getPlayerHandicapHistoryByIdImplementation } from './handicaps';


export function getAllPlayerIds(): Array<string> {
    return playersData.map((record) => record.id);
}

export function getAllPlayers(): Array<Player> {
    return playersData
        .map(record => getPlayerById(record.id))
        .filter(record => !!record) as Array<Player>;
}

export function getPlayerById(id: string): Player|undefined {
    let _record = playersData.find((event) => event.id === id)
    if (!_record) {
        return undefined
    }
    const player = PlayerSchema.parse(_record);
    // TODO: update handicap from handicap history, allowing the player data (players.json)
    // to manually override the history data:
    const handicapFromAPI = getPlayerHandicapById(player.id)
    const handicapOverride = player.handicap
    player.handicap = handicapOverride || handicapFromAPI
    return player
}

export function getPlayerHandicapHistoryById(id: string): HandicapHistoryEntry[] {
    return getPlayerHandicapHistoryByIdImplementation(id)
}

export function getPlayerHandicapById(id: string): number|undefined {
    let events: HandicapHistoryEntry[] = getPlayerHandicapHistoryById(id)
    if (events.length === 0) {
        return undefined
    }
    return events[events.length - 1].handicap;
}

export function getPlayerName(player: Player|string): string {
    if (typeof(player) === 'string') {
        const playerById = getPlayerById(player);
        if (playerById) {
            return getPlayerName(playerById);
        } else {
            return 'Unknown player';
        }
    }
    return `${player.name.first} ${player.name.last}`;
}

export function getPlayersAtEvent(event: any): Array<Player> {
    if (event.format === 'hector') {
        const teams = (event as HectorEvent).results?.teams || []
        const players = teams.flatMap(team => team.players.map(id => getPlayerById(id)))
        return players.filter(p => !!p) as Array<Player>;
    } else if (event.format === 'matchplay') {
        const players = (event as MatchplayEvent).results?.participants?.map(id => getPlayerById(id)) || []
        return players.filter(p => !!p) as Array<Player>;
    } else if (event.format === 'finnkampen') {
        const teams = (event as FinnkampenEvent).results?.teams || []
        const players = teams.flatMap(team => team.players.map(id => getPlayerById(id)))
        return players.filter(p => !!p) as Array<Player>;
    }
    return []
}

export function getEventsOfPlayer(playerId: string): Array<Event> {
    return getAllEvents().filter(event => getPlayersAtEvent(event).map(p => p.id).includes(playerId));
}
