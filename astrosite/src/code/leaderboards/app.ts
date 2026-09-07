import z from "zod";
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from "./types";
import { redact } from "../strings";

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

export type LeaderboardData = {
    hector: GoogleSheetTeamLeaderboard;
    victor: GoogleSheetIndividualLeaderboard;
};

/**
 * Fetches the tournament standings, or `undefined` if they could not be read.
 *
 * The distinction matters: an event that has not started yet legitimately has
 * empty leaderboards, so callers must not treat a failure as "no results" —
 * publishing that would wipe whatever standings are already live.
 */
export const fetchHectorLeaderboardDataFromApp = async (url: string): Promise<LeaderboardData | undefined> => {
    const json = await fetchTournamentDataFromApp(url);
    if (json === undefined) return undefined;
    const result = AppHectorGolfResponseSchema.safeParse(json);
    if (!result.success) {
        console.error(`Invalid response from Hector API. Error: ${result.error} Payload: ${JSON.stringify(json)}`);
        return undefined;
    }
    const hector = extractHectorResults(result.data);
    const victor = extractVictorResults(result.data);
    return { hector, victor };
};

function extractHectorResults(data: AppHectorGolfResponse): GoogleSheetTeamLeaderboard {
    return data.hector.map((entry) => ({
        team: entry.players,
        points: entry.points,
        diff: entry.diffToLeader ? String(entry.diffToLeader) : "",
        through: `${entry.roundsPlayed}/${data.rounds.length}`,
    }));
}

function extractVictorResults(data: AppHectorGolfResponse): GoogleSheetIndividualLeaderboard {
    return data.victor.map((entry) => ({
        player: entry.player,
        points: entry.points,
        diff: entry.diffToLeader ? String(entry.diffToLeader) : "",
        through: `${entry.roundsPlayed}/${data.rounds.length}`,
    }));
}

const AppHectorGolfResponseSchema = z.object({
    generatedAt: z.coerce.date(),
    event: z.object({
        id: z.string(),
        name: z.string(),
        venue: z.string(),
        dates: z.string(),
    }),
    status: z.enum(["upcoming", "live", "final"]),
    levelPar: z.number(),
    players: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            hi: z.number(),
            bucket: z.union([z.literal(1), z.literal(2)]),
        }),
    ),
    pairs: z.array(
        z.object({
            id: z.string(),
            defending: z.boolean(),
            players: z.array(z.string()),
        }),
    ),
    rounds: z.array(
        z.object({
            seq: z.number(),
            day: z.string(),
            date: z.coerce.date(),
            course: z.string(),
            status: z.enum(["final", "open", "upcoming"]),
            formats: z.array(z.string()),
        }),
    ),
    hector: z.array(
        z.object({
            // null until the event is under way and there is something to rank.
            position: z.number().nullable(),
            positionLabel: z.string(),
            pairId: z.string(),
            players: z.string(),
            points: z.number(),
            diffToLeader: z.number().optional().nullable(),
            thru: z.number().optional().nullable(),
            roundsPlayed: z.number(),
            perRound: z.record(z.string(), z.number()),
        }),
    ),
    victor: z.array(
        z.object({
            // null until the event is under way and there is something to rank.
            position: z.number().nullable(),
            positionLabel: z.string(),
            playerId: z.string(),
            player: z.string(),
            points: z.number(),
            diffToLeader: z.number().optional().nullable(),
            roundsPlayed: z.number(),
        }),
    ),
});

type AppHectorGolfResponse = z.infer<typeof AppHectorGolfResponseSchema>;
