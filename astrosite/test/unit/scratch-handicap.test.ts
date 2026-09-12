import { describe, expect, it, vi } from "vitest";

/**
 * A handicap of 0 is a real handicap.
 *
 * `getPlayerById` used to resolve the stored value against the scraped history
 * with `||`, and 0 is falsy — so a scratch player's handicap was discarded and
 * the history used instead. When the history was empty the result was
 * `undefined`, which is exactly the situation a hand-set handicap exists to
 * cover: WiseGolf has no figure, somebody typed one in, and the site dropped it
 * for being zero.
 *
 * The player data and the handicap history are both module-level values built by
 * globbing `src/data`, so they are mocked here rather than the committed files
 * being made to contain a scratch player.
 */
vi.mock("../../src/code/data.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/code/data.ts")>();
    return {
        ...actual,
        playersData: [
            // `players.ts` runs getAllPlayers() at import time and parses each of
            // these through the real schema, so they carry what it requires.
            {
                id: "scratch-s",
                name: { first: "Scratch", last: "Player" },
                privacy: "shorten-last-name",
                contact: { phone: "" },
                handicap: 0,
            },
            {
                id: "nohcp-n",
                name: { first: "Unknown", last: "Player" },
                privacy: "shorten-last-name",
                contact: { phone: "" },
            },
        ],
    };
});

vi.mock("../../src/code/handicaps.ts", () => ({
    // No history for anyone, which is the case a stopgap is for.
    getPlayerHandicapHistoryById: () => [],
}));

const { getPlayerById } = await import("../../src/code/players.ts");

describe("a hand-set handicap with no scraped history", () => {
    it("keeps a scratch handicap of 0 rather than dropping it as falsy", () => {
        expect(getPlayerById("scratch-s")?.handicap).toBe(0);
    });

    it("still reports no handicap for a player who has none", () => {
        expect(getPlayerById("nohcp-n")?.handicap).toBeUndefined();
    });
});
