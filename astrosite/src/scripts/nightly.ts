import { readFileSync } from 'fs'
import { join } from 'path';

import { getPlayerHandicap } from '../code/handicaps.ts';
import { getPlayerById } from '../code/players.ts';

const pathToPlayersJson = join(__dirname, '../data/players.json');

type Player = {
    id: string,
    name: {
        first: string,
        last: string
    },
    contact: {
        phone: string
    },
    image?: string,
    club?: string,
    handicap?: number,
}

const playersJson = JSON.parse(readFileSync(pathToPlayersJson, 'utf-8').toString());
console.log(`Attempting to update handicap data for ${playersJson.length} players...`)
const playerListPromises = playersJson.map((player: any) => {
    const playerObject = getPlayerById(player.id)
    if (playerObject) {
        const oldHandicap = player.handicap; // Let's save the old handicap
        return getPlayerHandicap(playerObject as Player).then((newHandicap) => {
            if (newHandicap && newHandicap !== oldHandicap) {
                playerObject.handicap = newHandicap;
            }
            return playerObject
        })
    } else {
        return Promise.resolve(playerObject)
    }
})

Promise.all(playerListPromises).then((players) => {
    console.log(`Updated ${players.length} players JSON:`)
    console.log(JSON.stringify(players, null, 2))
})
