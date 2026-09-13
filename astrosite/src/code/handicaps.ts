import { type Player } from "@hector/schemas/src/players.ts";
import { type HandicapSource } from "./handicaps/handicap-source-api";
import {
    type HandicapHistoryEntry,
    schema as HandicapHistoryEntrySchema,
    latestPerDay,
} from "@hector/schemas/src/handicaps.ts";
import { createWisegolfSession } from "./handicaps/wisegolf-api";

import handicapData from "../data/handicaps.json";

function createSources(): Promise<HandicapSource[]> {
    return Promise.all([createWisegolfSession()]);
}

export const getPlayerHandicap = async (player: Player): Promise<number | undefined> => {
    let hcp: number | undefined = undefined;
    if (player.club) {
        const sources = await createSources();
        for (let i = 0; i < sources.length && hcp === undefined; i++) {
            hcp = await sources[i].getPlayerHandicap(player.name.first, player.name.last, player.club);
        }
    }
    return hcp;
};

export const getPlayerHandicapHistory = (player: Player): HandicapHistoryEntry[] => {
    return getPlayerHandicapHistoryById(player.id);
};

/**
 * One player's handicap by day, oldest first.
 *
 * A day holding two readings is collapsed to the last of them, so a caller still
 * gets one value per date: the chart plots one point per day rather than two at
 * the same x, and `getPlayerHandicapById` taking the final element still means
 * "the most recent handicap". `observationsOn()` is there for the times you want
 * the readings themselves.
 */
export const getPlayerHandicapHistoryById = (id: string): HandicapHistoryEntry[] => {
    const events: HandicapHistoryEntry[] = handicapData
        .map((record) => HandicapHistoryEntrySchema.parse(record))
        .filter((event) => event.player === id);
    return latestPerDay(events);
};
