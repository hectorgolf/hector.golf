import { type Event, type HectorEvent, type MatchplayEvent, type FinnkampenEvent } from '../schemas/events';
import { getAllEvents } from './events';

import playersData from '../data/players.json';
import { type Player, schema as PlayerSchema } from '../schemas/players';


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
    return PlayerSchema.parse(_record);
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
