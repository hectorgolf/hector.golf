import { readFileSync } from 'fs'
import { join } from 'path';

import { getPlayerHandicap } from '../code/handicaps';
import { getPlayerById } from '../code/players';
import { type Player } from '../schemas/players';

const pathToPlayersJson = join(__dirname, '../data/players.json');

const playersJson = JSON.parse(readFileSync(pathToPlayersJson, 'utf-8').toString());
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
    console.log(JSON.stringify(players, null, 2))
})