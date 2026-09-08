import { expect, describe, it, afterEach, vi } from "vitest";

import { fetchHectorLeaderboardDataFromApp } from "../../../src/code/leaderboards/app.ts";

const URL = "https://app.hector.golf/api/tournament";

/** Serves one canned payload to the code under test, without touching the network. */
function serve(payload: unknown, status = 200) {
    vi.stubGlobal(
        "fetch",
        async () => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
    );
}

const ROUNDS = [
    { seq: 1, day: "Thu 24.9", date: "2026-09-24", course: "Radecký", status: "upcoming", formats: ["Stableford NET"] },
    { seq: 2, day: "Fri 25.9", date: "2026-09-25", course: "d'Este", status: "upcoming", formats: ["Stableford NET"] },
];

const BASE = {
    generatedAt: "2026-09-06T00:01:44.156Z",
    event: { id: "HECTOR2026", name: "Hector Trophée 2026", venue: "Konopiště", dates: "September 24–27, 2026" },
    levelPar: 240,
    players: [{ id: "lasse-k", name: "Lasse K", hi: 14.8, bucket: 2 }],
    pairs: [],
    rounds: ROUNDS,
};

/** What the API actually serves before the event starts: no ranks, no pairs. */
const UPCOMING = {
    ...BASE,
    status: "upcoming",
    hector: [],
    victor: [
        {
            position: null,
            positionLabel: "–",
            playerId: "lasse-k",
            player: "Lasse K",
            points: 0,
            toPar: 0,
            diffToLeader: null,
            roundsPlayed: 0,
        },
    ],
};

const LIVE = {
    ...BASE,
    status: "live",
    pairs: [{ id: "pair-1", defending: false, players: ["lasse-k", "toni-m"] }],
    hector: [
        {
            position: 1,
            positionLabel: "1",
            pairId: "pair-1",
            players: "Lasse K & Toni M",
            points: 71,
            diffToLeader: null,
            thru: 18,
            roundsPlayed: 1,
            perRound: { "1": 71 },
        },
    ],
    victor: [
        {
            position: 1,
            positionLabel: "1",
            playerId: "lasse-k",
            player: "Lasse K",
            points: 36,
            toPar: 2,
            diffToLeader: null,
            roundsPlayed: 1,
        },
        {
            position: 2,
            positionLabel: "2",
            playerId: "toni-m",
            player: "Toni M",
            points: 35,
            toPar: 3,
            diffToLeader: 1,
            roundsPlayed: 1,
        },
    ],
};

describe("Parsing app.hector.golf tournament responses", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("accepts an event that has not started yet", async () => {
        serve(UPCOMING);

        const data = await fetchHectorLeaderboardDataFromApp(URL);

        // Ranks are null and there are no pairs yet, but the payload is perfectly valid.
        expect(data).toBeDefined();
        expect(data!.hector).toEqual([]);
        expect(data!.victor).toEqual([{ player: "Lasse K", points: 0, diff: "", through: "0/2" }]);
    });

    it("accepts an event in progress", async () => {
        serve(LIVE);

        const data = await fetchHectorLeaderboardDataFromApp(URL);

        expect(data!.hector).toEqual([{ team: "Lasse K & Toni M", points: 71, diff: "", through: "1/2" }]);
        expect(data!.victor).toEqual([
            { player: "Lasse K", points: 36, diff: "", through: "1/2" },
            { player: "Toni M", points: 35, diff: "1", through: "1/2" },
        ]);
    });

    it("accepts a finished event", async () => {
        serve({ ...LIVE, status: "final" });

        expect(await fetchHectorLeaderboardDataFromApp(URL)).toBeDefined();
    });

    it("accepts an entry that only names the player, before any ranking exists", async () => {
        // What the API actually serves for an event that has not started yet:
        // no position, points, or rounds-played, just the entrant's name.
        serve({ ...UPCOMING, victor: [{ player: "Lasse K" }] });

        const data = await fetchHectorLeaderboardDataFromApp(URL);

        expect(data!.victor).toEqual([{ player: "Lasse K", points: 0, diff: "", through: "0/2" }]);
    });

    it("reports an unparseable payload rather than pretending the leaderboard is empty", async () => {
        serve({ ...UPCOMING, victor: [{ points: "36" }] });

        // An empty result would be published over the live standings; undefined
        // tells the caller to skip the update instead.
        expect(await fetchHectorLeaderboardDataFromApp(URL)).toBeUndefined();
    });

    it("reports an HTTP failure the same way", async () => {
        serve({ error: "nope" }, 503);

        expect(await fetchHectorLeaderboardDataFromApp(URL)).toBeUndefined();
    });
});
