import { describe, expect, it } from "vitest";

import { splitCompetitorNames } from "../../src/leaderboards/names.ts";

describe("splitCompetitorNames", () => {
    it("splits the Google Sheets separator", () => {
        expect(splitCompetitorNames("Lasse Koskela + Jari Kuusela")).toEqual(["Lasse Koskela", "Jari Kuusela"]);
    });

    it("splits the app.hector.golf separator", () => {
        // The reason this helper exists: the two sources disagree, and a pair whose
        // names do not split is a pair whose players do not get linked.
        expect(splitCompetitorNames("Lasse K & Toni M")).toEqual(["Lasse K", "Toni M"]);
    });

    it("returns a single name unchanged", () => {
        expect(splitCompetitorNames("Lasse Koskela")).toEqual(["Lasse Koskela"]);
    });

    it("drops empty fragments", () => {
        expect(splitCompetitorNames("Lasse Koskela + ")).toEqual(["Lasse Koskela"]);
        expect(splitCompetitorNames("")).toEqual([]);
    });
});
