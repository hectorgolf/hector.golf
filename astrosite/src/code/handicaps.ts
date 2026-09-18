import { type Player } from "@hector/schemas/src/players.ts";
import { type HandicapSource } from "@hector/wisegolf/src/handicap-source-api.ts";
import { type HandicapHistoryEntry, latestPerDay } from "@hector/schemas/src/handicaps.ts";
import { createWisegolfSession } from "@hector/wisegolf/src/wisegolf-api.ts";

import { loadHandicapHistory } from "./handicap-history-source";

/**
 * The whole history, resolved once, before anything asks for a player's.
 *
 * A top-level await rather than an async accessor, and that is the entire reason
 * the rest of this file is unchanged. `getPlayerHandicapById` is called from
 * `.astro` templates inside `.map()` callbacks and from `events.ts` in the
 * middle of building an event; making it async would turn a data-source change
 * into a rewrite of every one of those call sites, which is a lot of edits to
 * make in service of a fetch nobody at those call sites cares about.
 *
 * The module graph does the sequencing instead: Astro's build is ESM, so every
 * importer of this file waits for this line before it runs, and a page cannot
 * observe a half-loaded history. An exception here is a failed build, which is
 * what `loadHandicapHistory` wants for a build that had credentials and could
 * not use them.
 *
 * It used to be `import handicapData from "../data/handicaps.json"`. That file
 * is still written by `update-handicaps.yml` and still committed, but it is no
 * longer what the site reads — see `docs/plans/handicaps-to-firestore.md`, step
 * 4, for what has to happen before it can stop being written at all.
 */
const handicapData = await loadHandicapHistory();

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
    // No `schema.parse` here any more: `loadHandicapHistory` validates every row
    // as it reads it, from the API and from the backup alike, so doing it again
    // per player would re-validate the same 1,400 rows once for each of the 45.
    return latestPerDay(handicapData.filter((event) => event.player === id));
};
