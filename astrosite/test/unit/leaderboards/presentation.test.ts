import { describe, expect, it } from "vitest";

import {
    leaderboardPosition,
    normalizeDiff,
    pointsLabel,
    splitCompetitorNames,
    throughLabel,
} from "../../../src/code/leaderboards/presentation.ts";

describe("leaderboardPosition", () => {
    const strokes = [{ points: "222.0" }, { points: "224.9" }, { points: "224.9" }, { points: "231.3" }];

    it("ranks a lower score first when lower is better", () => {
        expect(leaderboardPosition(strokes, "222.0", true)).toBe("1");
        expect(leaderboardPosition(strokes, "231.3", true)).toBe("4");
    });

    it("marks a shared position with a T", () => {
        expect(leaderboardPosition(strokes, "224.9", true)).toBe("T2");
    });

    it("ranks a higher score first when higher is better", () => {
        const points = [{ points: 143 }, { points: 142 }, { points: 108 }];
        expect(leaderboardPosition(points, 143, false)).toBe("1");
        expect(leaderboardPosition(points, 108, false)).toBe("3");
    });

    it("ranks numbers and strings the same way", () => {
        // The build reads strings from a stored snapshot; the live board gets numbers
        // straight off the wire. Both have to produce the same board.
        expect(leaderboardPosition([{ points: 222 }, { points: 224.9 }], 222, true)).toBe("1");
        expect(leaderboardPosition([{ points: "222.0" }, { points: "224.9" }], "222.0", true)).toBe("1");
    });
});

describe("normalizeDiff", () => {
    it("leaves the leader's empty diff empty", () => {
        expect(normalizeDiff("")).toBe("");
    });

    it("prints nothing for a dead-level score", () => {
        expect(normalizeDiff("0.0")).toBe("");
    });

    it("gives a whole number a decimal", () => {
        expect(normalizeDiff("+2")).toBe("+2.0");
        expect(normalizeDiff("1")).toBe("1.0");
    });

    it("leaves an existing decimal alone", () => {
        expect(normalizeDiff("+2.9")).toBe("+2.9");
        expect(normalizeDiff("-1.0")).toBe("-1.0");
    });
});

describe("throughLabel", () => {
    it("prints F once every round is in", () => {
        expect(throughLabel("6/6")).toBe("F");
        expect(throughLabel("4/4")).toBe("F");
    });

    it("prints the raw progress mid-event", () => {
        expect(throughLabel("3/6")).toBe("3/6");
    });

    it("falls back to zero for an unknown progress", () => {
        expect(throughLabel("")).toBe("0");
    });
});

describe("pointsLabel", () => {
    it("passes a stored string through untouched", () => {
        expect(pointsLabel("222.0")).toBe("222.0");
    });

    it("gives a live number the one decimal the snapshots use", () => {
        expect(pointsLabel(222)).toBe("222.0");
        expect(pointsLabel(224.9)).toBe("224.9");
    });
});

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
