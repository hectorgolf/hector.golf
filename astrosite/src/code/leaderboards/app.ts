import z from "zod";
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from "./types";

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
        console.error("Error parsing HECTOR_APP_API_KEY: " + process.env.HECTOR_APP_API_KEY, error);
        return undefined;
    }
}

const apiKey = acquireApiKey();

const CACHE_TTL_MS = 10_000;

type CacheEntry = { expiresAt: number; payload: Promise<any> };

const cache = new Map<string, CacheEntry>();

const fetchTournamentDataFromApp = async (url: string): Promise<any> => {
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && cached.expiresAt > now) {
        return await cached.payload;
    }

    const payload = (async () => {
        const data = await fetch(url, {
            method: "GET",
            headers: {
                "x-api-key": String(apiKey),
                "Content-Type": "application/json",
            },
        });
        if (!data.ok) {
            console.error(`Failed to fetch Hector leaderboard data from ${url}: ${data.status} ${data.statusText}`);
            return [];
        }
        return await data.json();
    })();

    const entry: CacheEntry = { expiresAt: now + CACHE_TTL_MS, payload };
    cache.set(url, entry);
    // Don't let a failed request poison the cache for the whole TTL.
    payload.catch(() => {
        if (cache.get(url) === entry) cache.delete(url);
    });
    return await payload;
};

export const fetchHectorLeaderboardDataFromApp = async (url: string): Promise<GoogleSheetTeamLeaderboard> => {
    const json = await fetchTournamentDataFromApp(url);
    const result = AppHectorGolfResponseSchema.safeParse(json);
    if (result.error || !result.success) {
        console.error(`Invalid response from Hector API. Error: ${result.error} Payload: ${JSON.stringify(json)}`);
        return [];
    }
    return extractHectorResults(result.data);
};

export const fetchVictorLeaderboardDataFromApp = async (url: string): Promise<GoogleSheetIndividualLeaderboard> => {
    const json = await fetchTournamentDataFromApp(url);
    const result = AppHectorGolfResponseSchema.safeParse(json);
    if (result.error || !result.success) {
        console.error(`Invalid response from Hector API. Error: ${result.error} Payload: ${JSON.stringify(json)}`);
        return [];
    }
    return extractVictorResults(result.data);
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
    status: z.enum(["live"]),
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
            position: z.number(),
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
            position: z.number(),
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
