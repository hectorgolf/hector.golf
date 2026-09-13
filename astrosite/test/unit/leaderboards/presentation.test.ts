import { describe, expect, it } from "vitest";

import {
    decimalsForBoard,
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

describe("decimalsForBoard", () => {
    /*
     * Precision follows the unit, and the direction is how the unit is recorded:
     * lower-is-better means strokes, which go fractional once handicap
     * allowances are applied, and higher-is-better means Stableford points,
     * which do not come in halves.
     */
    it("gives a strokes board one decimal", () => {
        expect(decimalsForBoard(true)).toBe(1);
    });

    it("gives a Stableford board none", () => {
        expect(decimalsForBoard(false)).toBe(0);
    });
});

describe("normalizeDiff", () => {
    const STROKES = 1;
    const POINTS = 0;

    it("leaves the leader's empty diff empty", () => {
        expect(normalizeDiff("", STROKES)).toBe("");
        expect(normalizeDiff("", POINTS)).toBe("");
    });

    it("prints nothing for a dead-level score, however the source spelled zero", () => {
        expect(normalizeDiff("0.0", STROKES)).toBe("");
        expect(normalizeDiff("0", POINTS)).toBe("");
        expect(normalizeDiff("+0.0", POINTS)).toBe("");
    });

    it("prints a strokes gap to one decimal", () => {
        expect(normalizeDiff("+2", STROKES)).toBe("+2.0");
        expect(normalizeDiff("+2.9", STROKES)).toBe("+2.9");
        expect(normalizeDiff("-1.0", STROKES)).toBe("-1.0");
    });

    it("prints a Stableford gap whole, because there is no half a point", () => {
        expect(normalizeDiff("-3", POINTS)).toBe("-3");
        // The sheets have written the same gap both ways in different years; the
        // column has to read the same way down its whole length regardless.
        expect(normalizeDiff("-3.0", POINTS)).toBe("-3");
    });

    it("keeps the sign the source gave it", () => {
        expect(normalizeDiff("1", STROKES)).toBe("+1.0");
        expect(normalizeDiff("-1", POINTS)).toBe("-1");
    });

    it("hands back something that is not a number rather than printing NaN", () => {
        expect(normalizeDiff("AS", POINTS)).toBe("AS");
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
    const STROKES = 1;
    const POINTS = 0;

    it("prints a strokes score to one decimal, from a number or a stored string", () => {
        expect(pointsLabel(222, STROKES)).toBe("222.0");
        expect(pointsLabel(224.9, STROKES)).toBe("224.9");
        expect(pointsLabel("222.0", STROKES)).toBe("222.0");
    });

    it("prints a Stableford score whole", () => {
        expect(pointsLabel(143, POINTS)).toBe("143");
        // The reason this reformats rather than passing the stored string
        // through: the sheets wrote "150" for 2023 and "143.0" for 2025, and the
        // Victor board printed both, for the same kind of score.
        expect(pointsLabel("143.0", POINTS)).toBe("143");
        expect(pointsLabel("150", POINTS)).toBe("150");
    });

    it("hands back something that is not a number rather than printing NaN", () => {
        expect(pointsLabel("-", POINTS)).toBe("-");
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
