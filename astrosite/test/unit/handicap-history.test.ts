import { expect, describe, it } from "vitest";
import { getPlayerHandicapFromHistory, sortPlayersForBucketing } from "../../src/workflows/update-handicaps";
import type { HandicapHistoryEntry } from "../../src/schemas/handicaps";
import type { Player } from "../../src/schemas/players";

// sortPlayersForBucketing(handicapHistory: Array<HandicapHistoryEntry>, p1: Player, p2: Player)

const history: Array<HandicapHistoryEntry> = [
    // Adam's HCP has been steadily going up
    { player: "adam", date: "2025-08-01", handicap: 10.5 },
    { player: "adam", date: "2025-08-02", handicap: 11.2 },
    { player: "adam", date: "2025-08-03", handicap: 12.0 },
    // Ben's HCP has been fluctuating back and forth
    { player: "ben", date: "2025-08-01", handicap: 11.6 },
    { player: "ben", date: "2025-08-02", handicap: 11.2 },
    { player: "ben", date: "2025-08-03", handicap: 11.7 },
    // Charlie's HCP has been steadily going down
    { player: "charlie", date: "2025-08-01", handicap: 13.0 },
    { player: "charlie", date: "2025-08-02", handicap: 11.4 },
    { player: "charlie", date: "2025-08-03", handicap: 10.0 },
];

const adam: Player = {
    id: "adam",
    handicap: getPlayerHandicapFromHistory("adam", history),
    name: { first: "Adam", last: "Smith" },
    contact: { phone: "<omitted>" },
};

const ben: Player = {
    id: "ben",
    handicap: getPlayerHandicapFromHistory("ben", history),
    name: { first: "Ben", last: "Smith" },
    contact: { phone: "<omitted>" },
};

const charlie: Player = {
    id: "charlie",
    handicap: getPlayerHandicapFromHistory("charlie", history),
    name: { first: "Charlie", last: "Smith" },
    contact: { phone: "<omitted>" },
};

describe("Handicap history", () => {
    describe("getPlayerHandicapFromHistory()", () => {
        describe("by default", () => {
            it("returns the given player's latest handicap", () => {
                expect(getPlayerHandicapFromHistory(adam.id, history)).toBe(12.0);
                expect(getPlayerHandicapFromHistory(ben.id, history)).toBe(11.7);
                expect(getPlayerHandicapFromHistory(charlie.id, history)).toBe(10.0);
            });
        });

        describe("with offset 0", () => {
            it("returns the given player's latest handicap", () => {
                expect(getPlayerHandicapFromHistory(adam.id, history, 0)).toBe(12.0);
                expect(getPlayerHandicapFromHistory(ben.id, history, 0)).toBe(11.7);
                expect(getPlayerHandicapFromHistory(charlie.id, history, 0)).toBe(10.0);
            });
        });

        describe("with offset -1", () => {
            it("returns the given player's second-to-latest handicap", () => {
                expect(getPlayerHandicapFromHistory(adam.id, history, -1)).toBe(11.2);
                expect(getPlayerHandicapFromHistory(ben.id, history, -1)).toBe(11.2);
                expect(getPlayerHandicapFromHistory(charlie.id, history, -1)).toBe(11.4);
            });
        });

        describe("with offset -2", () => {
            it("returns the given player's third-to-latest handicap", () => {
                expect(getPlayerHandicapFromHistory(adam.id, history, -2)).toBe(10.5);
                expect(getPlayerHandicapFromHistory(ben.id, history, -2)).toBe(11.6);
                expect(getPlayerHandicapFromHistory(charlie.id, history, -2)).toBe(13.0);
            });
        });
    });
});
