import { describe, expect, it } from "vitest";

import { readAppLeaderboardPayload } from "../../../src/code/leaderboards/app-payload.ts";

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
            { team: "Jari K & Sami H", points: 74.5, diff: "3.5", through: "1/3" },
        ]);
        expect(snapshot.victor).toEqual([
            { player: "Lasse K", points: 36, diff: "", through: "1/3" },
            { player: "Toni M", points: 35, diff: "1", through: "1/3" },
        ]);
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
