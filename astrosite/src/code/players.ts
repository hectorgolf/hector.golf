import { type Event } from '@hector/schemas/src/events.ts';
import { type Player, schema as PlayerSchema } from '@hector/schemas/src/players.ts';
import { type HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts';
import { getPlayerHandicapHistoryById as getPlayerHandicapHistoryByIdImplementation } from './handicaps';
import { getAllEvents } from './events';
import { playersData, endDateOfEvent, isHectorEvent, isMatchplayEvent, isFinnkampenEvent } from './data';

export function getAllPlayerIds(): Array<string> {
    return playersData.map((record) => record.id);
}

export function getAllPlayers(): Array<Player> {
    return playersData
        .map(record => getPlayerById(record.id))
        .filter(record => !!record) as Array<Player>;
}

/**
 * Which handicap a player has, given both kinds.
 *
 * The official reading wins, and the hand-set one is what is left when there is
 * no official reading — which is the whole meaning of a stopgap. See
 * `docs/current/data-ownership.md`.
 *
 * It used to be the other way round, and the reason that worked was that
 * `update-handicaps.ts` overwrote the player file: the stored value won, and CI
 * retired it within hours by replacing it, so "stored wins" and "official wins"
 * were the same thing a tick apart. That write went away on 2026-09-18 and they
 * stopped being the same thing — a stopgap would have shadowed an official
 * handicap until some unrelated workflow next rewrote the player, which for the
 * biographies run is a fortnight. A stopgap that outlives the official figure by
 * a fortnight is not a stopgap.
 *
 * Reversing it puts the precedence where the meaning already was, and makes this
 * agree with `events.ts`, which has always resolved the same pair official-first.
 *
 * `??` and not `||`: a scratch player's handicap is 0, and 0 is falsy, so `||`
 * would discard a real 0 from the history and fall through to the stopgap.
 *
 * A named function rather than an expression inline because the *order* is the
 * decision, and an order is worth being able to test without standing in for a
 * module graph.
 */
export function resolveHandicap(official: number | undefined, stopgap: number | undefined): number | undefined {
    return official ?? stopgap;
}

export function getPlayerById(id: string): Player|undefined {
    let _record = playersData.find((event) => event.id === id)
    if (!_record) {
        return undefined
    }
    const player = PlayerSchema.parse(_record);
    player.handicap = resolveHandicap(getPlayerHandicapById(player.id), player.handicap)
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

// const longestCommonPrefix = (strings: Array<string>): number => {
//     const longest = Math.max(...strings.map(s => s.length))
//     for (let length = 1; length <= longest; length++) {
//         const uniques = [...new Set<string>(strings.map(s => s.slice(0, length)))]
//         if (uniques.length === strings.length) {
//             return length - 1
//         }
//     }
//     return 0
// }

const shortestUniquePrefix = (strings: Array<string>): number => {
    const longest = Math.max(...strings.map(s => s.length))
    for (let length = 1; length <= longest; length++) {
        const uniques = [...new Set<string>(strings.map(s => s.slice(0, length)))]
        if (uniques.length === strings.length) {
            return length
        }
    }
    console.warn(`There is no unique prefix for ${JSON.stringify(strings)}`)
    return 0
}

/**
 * Let's compute a set of mappings for player names that are privacy-sensitive, i.e. their
 * last names should be shortened. We will use the shortest unique prefix of the last names
 * to figure out how much of the last name to keep. If there are no duplicate first names
 * among players with shortened last names, we will keep the full first name and take just
 * the first letter of their last name. If there are e.g. a "John Deere" and a "John Dillinger",
 * we'd need to keep two letters of their last name to distinguish the two individuals.
 */
type PlayerName = { first: string, last: string }
type NameShorteningFunction = (playerOrName: Player|PlayerName|string) => string
const shortenLastName: NameShorteningFunction = (() => {
    const playersByFirstName = new Map<string, Array<Player>>();
    const shortenedLastNamesById = new Map<string, string>();
    const shortenedLastNamesByFullName = new Map<string, string>();
    getAllPlayers().forEach(player => {
        const firstName = player.name.first;
        if (!playersByFirstName.has(firstName)) {
            playersByFirstName.set(firstName, []);
        }
        playersByFirstName.get(firstName)?.push(player);
    })
    for (let firstName of playersByFirstName.keys()) {
        const playersWithSameFirstName = playersByFirstName.get(firstName) || []
        const playersWithShortenedLastName = playersWithSameFirstName.filter(player => player.privacy === 'shorten-last-name')
        const lastNames = playersWithShortenedLastName.map(player => player.name.last.toUpperCase())
        const prefixLength = shortestUniquePrefix(lastNames)
        playersWithShortenedLastName.forEach(player => {
            shortenedLastNamesById.set(player.id, player.name.last.slice(0, prefixLength))
            shortenedLastNamesByFullName.set(`${player.name.first} ${player.name.last}`, player.name.last.slice(0, prefixLength))
            player.aliases?.forEach(alias => {
                shortenedLastNamesByFullName.set(`${alias.first} ${alias.last}`, alias.last.slice(0, prefixLength))
            })
        })
    }
    return (playerOrName: Player|PlayerName|string): string => {
        if (typeof(playerOrName) === 'string') {
            return shortenedLastNamesById.get(playerOrName) || shortenedLastNamesByFullName.get(playerOrName) || '?'
        }
        if (typeof(playerOrName) === 'object') {
            const obj = playerOrName as any
            if (obj.id && obj.name) {
                const { id, name } = obj
                return shortenedLastNamesById.get(id) || name.last.slice(0, 1)
            }
            if (obj.first && obj.last) {
                const { first, last } = obj
                const mapping = shortenedLastNamesByFullName.get(`${first} ${last}`)
                if (mapping) {
                    return mapping
                }
                console.warn(`No mapping for ${JSON.stringify(playerOrName)} among ${JSON.stringify(Array.from(shortenedLastNamesByFullName.keys()))} or  ${JSON.stringify(Array.from(shortenedLastNamesById.keys()))}`)
            }
        }
        throw new Error(`Unsupported parameter to shortenLastName: ${typeof(playerOrName)} ${JSON.stringify(playerOrName)}`)
    }
})()

const renderPlayerName = (name: { first: string, last: string }, privacySetting?: string): string => {
    if (privacySetting === 'shorten-last-name') {
        return `${name.first} ${shortenLastName(name)}`
    }
    return `${name.first} ${name.last}`
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
    return renderPlayerName(player.name, player.privacy);
}

export function getPlayerByName(name: string): Player|undefined {
    return getAllPlayers().find(player => {
        return getPlayerAliases(player).includes(name)
    })
}

export function getPlayerAliases(player: Player|string, ignorePrivacy?: boolean): Array<string> {
    if (typeof(player) === 'string') {
        const playerById = getPlayerById(player);
        if (playerById) {
            return getPlayerAliases(playerById);
        } else {
            return [];
        }
    }
    return [player.name, ...(player.aliases || [])].map(name => renderPlayerName(name, ignorePrivacy ? undefined : player.privacy));
}

function getPlayersAtEvent(event: Event): Array<Player> {
    if (isHectorEvent(event)) {
        const teams = event.results?.teams || []
        const players = teams.flatMap(team => team.players.map(id => getPlayerById(id)))
        return players.filter(p => !!p) as Array<Player>;
    } else if (isMatchplayEvent(event)) {
        const players = event.participants?.map(id => getPlayerById(id)) || []
        return players.filter(p => !!p) as Array<Player>;
    } else if (isFinnkampenEvent(event)) {
        const teams = event.results?.teams || []
        const players = teams.flatMap(team => team.players.map(id => getPlayerById(id)))
        return players.filter(p => !!p) as Array<Player>;
    }
    return []
}

export function getEventsOfPlayer(playerId: string): Array<Event> {
    return getAllEvents()
        .filter(event => getPlayersAtEvent(event).map(p => p.id).includes(playerId))
        .sort((a, b) => endDateOfEvent(b).getTime() - endDateOfEvent(a).getTime());
}
