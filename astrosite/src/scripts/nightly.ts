import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { getPlayerHandicap, withLogin } from '../code/handicaps/teetime-api.ts';

import playersData from '../data/players.json';

function getPlayerById(id: string): Player|undefined {
    let _record = playersData.find((record) => record.id === id)
    if (!_record) {
        return undefined
    }
    return _record as Player
}

// Get the resolved path to this file and determine the directory from that
// (__dirname is not available in ES6 modules)
const __filename = fileURLToPath(import.meta.url);
const pathToPlayersJson = join(dirname(__filename), '../data/players.json');

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

withLogin(async (token: string) => {
    console.log(`Logged in with token: ${token}`)
    const playerListPromises = playersJson.map((player: any) => {
        const playerObject = getPlayerById(player.id)
        if (playerObject && playerObject.club) {
            const oldHandicap = player.handicap; // Let's save the old handicap
            return getPlayerHandicap(playerObject.name.first, playerObject.name.last, playerObject.club, token).then((newHandicap) => {
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
        writeFileSync(pathToPlayersJson, JSON.stringify(players, null, 2))
    })
})

