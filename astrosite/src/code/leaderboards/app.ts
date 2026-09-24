import { redact } from "../strings";
import {
    extractHectorRows,
    extractVictorRows,
    type AppLeaderboardPayload,
    type LeaderboardData,
} from "@hector/schemas/src/leaderboards/app-payload.ts";
import { appTournamentResponseSchema } from "@hector/schemas/src/leaderboards/app-response.ts";

export type { LeaderboardData };

function acquireApiKey() {
    try {
        const value = process.env.HECTOR_APP_API_KEY;
        if (!value) {
            console.warn(
                "HECTOR_APP_API_KEY environment variable is not set - app.hector.golf authentication will not work",
            );
            return undefined;
        }
        return value.trim();
    } catch (error) {
        console.error(`Error parsing HECTOR_APP_API_KEY: ${redact(process.env.HECTOR_APP_API_KEY)}`, error);
        return undefined;
    }
}

const apiKey = acquireApiKey();

const fetchTournamentDataFromApp = async (url: string): Promise<any | undefined> => {
    const data = await fetch(url, {
        method: "GET",
        headers: {
            "x-api-key": String(apiKey),
            "Content-Type": "application/json",
        },
    });
    if (!data.ok) {
        console.error(`Failed to fetch Hector leaderboard data from ${url}: ${data.status} ${data.statusText}`);
        return undefined;
    }
    return await data.json();
};

/**
 * Fetches the tournament standings, or `undefined` if they could not be read.
 *
 * The distinction matters: an event that has not started yet legitimately has
 * empty leaderboards, so callers must not treat a failure as "no results" —
 * publishing that would wipe whatever standings are already live.
 *
 * This is the strict path: the payload is validated in full, by the schema in
 * `@hector/schemas`, before any of it is believed. The browser-side live
 * leaderboard reads the same payload through `readAppLeaderboardPayload`, which
 * checks only the fields it renders.
 *
 * Nothing on the site publishes what this returns any more — the admin service's
 * `leaderboards` job took the app-sourced events on 2026-09-24. What keeps this
 * here is `test/unit/integrations/hectorapp-api.test.ts`, which calls it against
 * the real endpoint on every CI run: that test is how a change to the upstream
 * payload is noticed, and the schema it exercises is the one the admin publishes
 * from.
 */
export const fetchHectorLeaderboardDataFromApp = async (url: string): Promise<LeaderboardData | undefined> => {
    const json = await fetchTournamentDataFromApp(url);
    if (json === undefined) return undefined;
    const result = appTournamentResponseSchema.safeParse(json);
    if (!result.success) {
        console.error(`Invalid response from Hector API. Error: ${result.error} Payload: ${JSON.stringify(json)}`);
        return undefined;
    }
    const payload = result.data as AppLeaderboardPayload;
    return { hector: extractHectorRows(payload), victor: extractVictorRows(payload) };
};
