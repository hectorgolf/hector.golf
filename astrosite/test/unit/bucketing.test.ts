import { expect, describe, it } from "vitest";
import { getPlayerHandicapFromHistory } from "@hector/schemas/src/handicaps.ts";
import { bucketingOrder } from "@hector/schemas/src/buckets.ts";
import type { HandicapHistoryEntry } from "@hector/schemas/src/handicaps.ts";
import type { Player } from "@hector/schemas/src/players.ts";

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

/**
 * The comparator takes the name renderer rather than importing one, and that is the
 * only part of this that moved when the sort did.
 *
 * The site renders a player's name with the last name shortened for privacy, which it
 * can only do by reading the whole roster: the shortened form is the shortest prefix
 * that is unique among the players sharing a first name. That closure cannot live in
 * `@hector/schemas`, and the admin service — which has no roster on disk — has nothing
 * to build it from. So the tiebreak asks for a name instead of deciding how to make one.
 *
 * The two renderers cannot disagree on today's data. A shortened last name differs from
 * its neighbours' at or before the truncation point, by construction, so ordering on
 * "Eero H" and "Eero S" is the same ordering as on "Eero Halmetoja" and "Eero Somervuo".
 * That is a property of the roster rather than of the code, which is why this is a
 * parameter and not a rewrite.
 */
const nameOf = (player: Player): string => `${player.name.first} ${player.name.last}`;

describe("Sorting for buckets", () => {
    describe("bucketingOrder()", () => {

        function sort(...players: Player[]): string[] {
            return players.sort(bucketingOrder(history, nameOf)).map(p => p.id);
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

        describe("with nothing between them at all", () => {
            // Adam and Eldrick are level today and level yesterday, so the name is
            // what decides — which is the one thing the caller supplies.
            const flat: Array<HandicapHistoryEntry> = [
                { player: "adam", date: "2025-08-03", handicap: 10.0 },
                { player: "eldrick", date: "2025-08-03", handicap: 10.0 },
            ];

            it("falls back to the name the caller renders", () => {
                const byName = [eldrick, adam].sort(bucketingOrder(flat, nameOf)).map(p => p.id);
                expect(byName).toStrictEqual(["adam", "eldrick"]);

                const backwards = [adam, eldrick]
                    .sort(bucketingOrder(flat, (p) => p.name.first.split("").reverse().join("")))
                    .map(p => p.id);
                expect(backwards).toStrictEqual(["eldrick", "adam"]);
            });
        });
    });
});
