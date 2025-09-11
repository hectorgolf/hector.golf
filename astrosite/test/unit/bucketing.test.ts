import { expect, describe, it } from "vitest";
import { getPlayerHandicapFromHistory, sortPlayersForBucketing } from "../../src/workflows/update-handicaps";
import type { HandicapHistoryEntry } from "../../src/schemas/handicaps";
import type { Player } from "../../src/schemas/players";

// sortPlayersForBucketing(handicapHistory: Array<HandicapHistoryEntry>, p1: Player, p2: Player)

const history: Array<HandicapHistoryEntry> = [
    // Adam's HCP has been fluctuating back and forth
    { player: "adam", date: "2025-08-01", handicap: 10.0 },
    { player: "adam", date: "2025-08-02", handicap: 9.0 },
    { player: "adam", date: "2025-08-03", handicap: 10.0 },
    // Ben's HCP has been steadily going up
    { player: "ben", date: "2025-08-01", handicap: 10.5 },
    { player: "ben", date: "2025-08-02", handicap: 11.2 },
    { player: "ben", date: "2025-08-03", handicap: 12.0 },
    // Charlie's HCP has been fluctuating back and forth
    { player: "charlie", date: "2025-08-01", handicap: 11.6 },
    { player: "charlie", date: "2025-08-02", handicap: 11.2 },
    { player: "charlie", date: "2025-08-03", handicap: 11.7 },
    // David's HCP has been steadily going down
    { player: "david", date: "2025-08-01", handicap: 13.0 },
    { player: "david", date: "2025-08-02", handicap: 11.4 },
    { player: "david", date: "2025-08-03", handicap: 10.0 },
    // Eldrick's HCP has stayed the same all the time
    { player: "eldrick", date: "2025-08-01", handicap: 10.0 },
    { player: "eldrick", date: "2025-08-02", handicap: 10.0 },
    { player: "eldrick", date: "2025-08-03", handicap: 10.0 },
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

const david: Player = {
    id: "david",
    handicap: getPlayerHandicapFromHistory("david", history),
    name: { first: "David", last: "Smith" },
    contact: { phone: "<omitted>" },
};

const eldrick: Player = {
    id: "eldrick",
    handicap: getPlayerHandicapFromHistory("eldrick", history),
    name: { first: "Eldrick", last: "Smith" },
    contact: { phone: "<omitted>" },
};

describe("Sorting for buckets", () => {
    describe("sortPlayersForBucketing()", () => {

        function sort(...players: Player[]): string[] {
            return players.sort((a, b) => sortPlayersForBucketing(history, a, b)).map(p => p.id);
        }

        describe("with different handicaps", () => {
            it("should return lower handicap first", () => {
                expect(sort(adam, ben)).toStrictEqual([adam.id, ben.id]);
                expect(sort(adam, charlie)).toStrictEqual([adam.id, charlie.id]);
                expect(sort(ben, charlie)).toStrictEqual([charlie.id, ben.id]);
            });
        });

        describe("with same current handicap", () => {
            it("should return the player whose handicap has gone down", () => {
                expect(sort(adam, david)).toStrictEqual([david.id, adam.id]);
                expect(sort(adam, eldrick)).toStrictEqual([eldrick.id, adam.id]);
                expect(sort(david, eldrick)).toStrictEqual([david.id, eldrick.id]);
            });
        });
    });
});
