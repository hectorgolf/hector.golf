import { expect, describe, it } from "vitest";

import { fetchHectorLeaderboardDataFromApp } from "../../../src/code/leaderboards/app.ts";

describe("Integration to app.hector.golf", () => {
    describe("Downloading leaderboard data", async () => {
        const url = "https://app.hector.golf/api/tournament";
        const data = await fetchHectorLeaderboardDataFromApp(url);

        it("produces some data for Hector leaderboard", async () => {
            expect(data.hector.length).toBeGreaterThan(0);
            expect(data.hector[0].team).toBeDefined();
        });

        it("produces some data for Victor leaderboard", async () => {
            expect(data.victor.length).toBeGreaterThan(0);
            expect(data.victor[0].player).toBeDefined();
        });
    });
});
