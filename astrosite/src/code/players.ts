import { type Event } from '@hector/schemas/src/events.ts';
import { type Player, schema as PlayerSchema } from '@hector/schemas/src/players.ts';
import { type HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts';
import { getPlayerHandicapHistoryById as getPlayerHandicapHistoryByIdImplementation } from './handicaps';
import { getAllEvents } from './events';
import { playersData, playerDataPath, endDateOfEvent, isHectorEvent, isMatchplayEvent, isFinnkampenEvent } from './data';
import { writeJsonFile } from './json';

/**
 * Write a player's file, without the handicap the history already knows.
 *
 * ## Why this drops a field the caller passed in
 *
 * `player.handicap` has always meant two things at once: a stopgap somebody typed
 * for a player WiseGolf has never heard of, and a cache of the scrape's latest
 * reading. `data-ownership.md` calls that out as one of the hard rows, and the
 * second meaning is what stops being needed here — since step 3 the site resolves
 * a handicap as `player.handicap ?? latest-from-the-history`, and the history is
 * a fetch away at build time. A cached copy of something we now read directly is
 * a second source of truth for no benefit.
 *
 * It is dropped *here*, in the writer, rather than at the one call site that
 * obviously wrote it, because it was not the only one. `getPlayerById` resolves
 * the field before returning, so anything that reads a player and writes it back
 * persists the resolved value — `update-player-biographies.ts` and
 * `update-player-club-memberships.ts` both do, on every run. Removing the write
 * in `update-handicaps.ts` alone would have left those two putting it straight
 * back, and the field would have looked maintained while nothing maintained it.
 *
 * ## What is kept
 *
 * The stopgap, which is the meaning worth having. A player the history says
 * nothing about keeps whatever is in their file, because that is the case the
 * field exists for and there is nowhere else for the value to live. Today no
 * player is in that state — all forty with a handicap also have history — but a
 * new member with no WiseGolf record is one signup away from it.
 */
export async function updatePlayerData(player: Player): Promise<void> {
    const path = await playerDataPath(player);
    if (!path) {
        return Promise.reject(`No path found for player ${player.id}`);
    }
    const { handicap, ...rest } = player;
    const derived = getPlayerHandicapById(player.id) !== undefined;
    writeJsonFile(path, derived ? rest : player);
}

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
    // A hand-set handicap is a stopgap for a player WiseGolf has no figure for,
    // and `update-handicaps.ts` replaces it as soon as there is a real one — see
    // docs/current/data-ownership.md. So the stored value wins here only because CI has
    // not overwritten it yet, which is the intended precedence.
    //
    // `??` and not `||`: a scratch player's handicap is 0, and 0 is falsy, so
    // `||` discarded it and fell through to the history — leaving `undefined`
    // when the history was empty, which is precisely the case a stopgap exists
    // to cover. `events.ts` already resolves the same pair with `??`.
    const handicapFromAPI = getPlayerHandicapById(player.id)
    const handicapOverride = player.handicap
    player.handicap = handicapOverride ?? handicapFromAPI
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
