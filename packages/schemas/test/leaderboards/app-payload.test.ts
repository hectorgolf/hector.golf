import { describe, expect, it } from "vitest";

import { readAppLeaderboardPayload } from "../../src/leaderboards/app-payload.ts";
import { BOARD_SCORING } from "../../src/leaderboards/types.ts";

const PAYLOAD = {
    generatedAt: "2026-09-25T11:04:12.000Z",
    status: "live",
    rounds: [{ seq: 1 }, { seq: 2 }, { seq: 3 }],
    hector: [
        { players: "Lasse K & Toni M", points: 71, diffToLeader: null, roundsPlayed: 1 },
        { players: "Jari K & Sami H", points: 74.5, diffToLeader: 3.5, roundsPlayed: 1 },
    ],
    victor: [
        { player: "Lasse K", points: 36, diffToLeader: null, roundsPlayed: 1 },
        { player: "Toni M", points: 35, diffToLeader: 1, roundsPlayed: 1 },
    ],
};

describe("readAppLeaderboardPayload", () => {
    it("reads both boards", () => {
        const snapshot = readAppLeaderboardPayload(PAYLOAD)!;
        expect(snapshot.hector).toEqual([
            { team: "Lasse K & Toni M", points: 71, diff: "", through: "1/3" },
            { team: "Jari K & Sami H", points: 74.5, diff: "+3.5", through: "1/3" },
        ]);
        expect(snapshot.victor).toEqual([
            { player: "Lasse K", points: 36, diff: "", through: "1/3" },
            { player: "Toni M", points: 35, diff: "-1", through: "1/3" },
        ]);
    });

    /**
     * The app sends `diffToLeader` as a magnitude — how far behind, never which
     * way — while the board renders whatever string it is handed. So these rows
     * used to print "3.5" where a sheet-sourced row prints "+3.5", and the sign
     * is the whole point of the column: it says which side of the leader you are
     * on, on a board where that is not obvious from the number.
     */
    describe("signing the gap to the leader", () => {
        const diffsFor = (payload: Record<string, unknown>) => {
            const snapshot = readAppLeaderboardPayload({ ...PAYLOAD, ...payload })!;
            return {
                hector: snapshot.hector.map((row) => row.diff),
                victor: snapshot.victor.map((row) => row.diff),
            };
        };

        it("marks a Hector gap positive, because a stroke behind is a stroke more", () => {
            expect(diffsFor({}).hector).toEqual(["", "+3.5"]);
        });

        it("marks a Victor gap negative, because a point behind is a point fewer", () => {
            expect(diffsFor({}).victor).toEqual(["", "-1"]);
        });

        it("prints nothing for the leader and nothing for a dead-level row", () => {
            // Zero is a row with no gap to show rather than a gap of zero. A
            // column of "+0.0" against the leader reads as a score, not a gap —
            // the same reason `normalizeDiff` reduces a sheet's "0.0" to "".
            const diffs = diffsFor({
                hector: [
                    { players: "Leader", points: 71, diffToLeader: null, roundsPlayed: 1 },
                    { players: "Level", points: 71, diffToLeader: 0, roundsPlayed: 1 },
                    { players: "Absent", points: 71, roundsPlayed: 1 },
                ],
            });
            expect(diffs.hector).toEqual(["", "", ""]);
        });

        it("does not double-sign if upstream ever starts sending the sign itself", () => {
            // Defensive rather than speculative: the payload's own type allows a
            // negative, and "+-3" on the board would be worse than either answer.
            const diffs = diffsFor({
                hector: [{ players: "Behind", points: 74.5, diffToLeader: -3.5, roundsPlayed: 1 }],
                victor: [{ player: "Behind", points: 35, diffToLeader: -1, roundsPlayed: 1 }],
            });
            expect(diffs.hector).toEqual(["+3.5"]);
            expect(diffs.victor).toEqual(["-1"]);
        });

        it("agrees with the direction the writer stamps into the file", () => {
            // These two facts must not drift: the file says which way the board
            // runs, and the sign here has to mean the same thing.
            expect(BOARD_SCORING.hector).toBe("ascending");
            expect(BOARD_SCORING.victor).toBe("descending");
        });
    });

    it("carries the generation time and status through", () => {
        const snapshot = readAppLeaderboardPayload(PAYLOAD)!;
        expect(snapshot.generatedAt).toBe("2026-09-25T11:04:12.000Z");
        expect(snapshot.status).toBe("live");
    });

    it("reads a payload that has no standings yet", () => {
        const snapshot = readAppLeaderboardPayload({ ...PAYLOAD, hector: [], victor: [] })!;
        expect(snapshot.hector).toEqual([]);
        expect(snapshot.victor).toEqual([]);
    });

    it("reads an entry that only names the player, before any ranking exists", () => {
        const snapshot = readAppLeaderboardPayload({ ...PAYLOAD, victor: [{ player: "Lasse K" }] })!;
        expect(snapshot.victor).toEqual([{ player: "Lasse K", points: 0, diff: "", through: "0/3" }]);
    });

    it("ignores fields it does not render", () => {
        // The strict schema in app.ts guards the path that writes to disk. Here an
        // extra or missing decoration must not cost the viewer a live update.
        const snapshot = readAppLeaderboardPayload({ ...PAYLOAD, levelPar: undefined, surprise: true });
        expect(snapshot).toBeDefined();
    });

    for (const [name, json] of [
        ["null", null],
        ["a string", "nope"],
        ["an array", []],
        ["a payload with no rounds", { ...PAYLOAD, rounds: undefined }],
        ["a payload with no boards", { rounds: [] }],
        ["a board that is not an array", { ...PAYLOAD, victor: {} }],
        ["an entry missing its name", { ...PAYLOAD, victor: [{ points: 36, roundsPlayed: 1 }] }],
        ["an entry whose score is a string", { ...PAYLOAD, victor: [{ player: "X", points: "36", roundsPlayed: 1 }] }],
    ] as Array<[string, unknown]>) {
        it(`refuses ${name}`, () => {
            // undefined means "leave the published standings alone", which is the
            // only safe reading of a payload we do not recognise.
            expect(readAppLeaderboardPayload(json)).toBeUndefined();
        });
    }
});
