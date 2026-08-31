import { expect, describe, it } from "vitest";

import {
    fetchHectorLeaderboardDataFromApp,
    fetchVictorLeaderboardDataFromApp,
} from "../../../src/code/leaderboards/app.ts";

describe("Integration to app.hector.golf", () => {
    describe("Downloading leaderboard data", async () => {
        const url = "https://app.hector.golf/api/tournament";

        describe("Hector", () => {
            it("produces some data", async () => {
                const data = await fetchHectorLeaderboardDataFromApp(url);
                expect(data.length).toBeGreaterThan(0);
                expect(data[0].team).toBeDefined();
            });
        });

        describe("Victor", () => {
            it("produces some data", async () => {
                const data = await fetchVictorLeaderboardDataFromApp(url);
                expect(data.length).toBeGreaterThan(0);
                expect(data[0].player).toBeDefined();
            });
        });
    });
});
