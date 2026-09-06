import { expect, describe, it } from "vitest";

import { fetchHectorLeaderboardDataFromApp } from "../../../src/code/leaderboards/app.ts";

describe("Integration to app.hector.golf", () => {
    describe("Downloading leaderboard data", async () => {
        const url = "https://app.hector.golf/api/tournament";
        const data = await fetchHectorLeaderboardDataFromApp(url);

        it("reads and parses the live response", async () => {
            // undefined means the fetch failed or the payload no longer matches our
            // schema — the case that silently emptied the leaderboard in the past.
            expect(data).toBeDefined();
        });

        it("produces some data for Victor leaderboard", async () => {
            expect(data!.victor.length).toBeGreaterThan(0);
            expect(data!.victor[0]!.player).toBeDefined();
            expect(data!.victor[0]!.through).toMatch(/^\d+\/\d+$/);
        });

        it("produces well-formed data for Hector leaderboard", async () => {
            // Hector is a pairs competition, so it is legitimately empty until the
            // pairs have been drawn. Only the shape is guaranteed year-round.
            expect(Array.isArray(data!.hector)).toBe(true);
            for (const entry of data!.hector) {
                expect(entry.team).toBeDefined();
                expect(entry.through).toMatch(/^\d+\/\d+$/);
            }
        });
    });
});
