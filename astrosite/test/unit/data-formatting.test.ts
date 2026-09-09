import { readFileSync } from "fs";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

import { serializeJson } from "../../src/code/json.ts";

/**
 * Holds the committed data files to the one format the writers produce.
 *
 * The writers used to disagree — five call sites wrote two-space and three wrote
 * four-space — so a file touched by the handicap job came back reformatted from
 * what the leaderboard job had left, and the diff of a run that changed one
 * handicap ran to hundreds of lines. This test is what stops that returning: a
 * new writer that reaches for `JSON.stringify` directly fails here rather than in
 * a confusing commit six months later.
 *
 * `src/data/courses/` is deliberately exempt. Those files are hand-maintained and
 * hand-formatted — each scorecard is laid out one hole per line with the columns
 * aligned, which is far more readable than the exploded form and which
 * `JSON.stringify` cannot reproduce. No writer touches them, so there is nothing
 * to guard.
 */
const HAND_MAINTAINED = "src/data/courses/";

const dataFiles = (await glob("src/data/**/*.json"))
    .filter((file) => !file.startsWith(HAND_MAINTAINED))
    .sort();

describe("committed JSON data files", () => {
    it("covers every directory a writer writes to", () => {
        // Guards against a glob or filter mistake quietly making this suite vacuous.
        const directories = new Set(dataFiles.map((file) => file.slice(0, file.lastIndexOf("/"))));
        expect(directories).toContain("src/data");
        expect(directories).toContain("src/data/players");
        expect(directories).toContain("src/data/leaderboards");
        expect(directories).toContain("src/data/events/hector");
        expect(dataFiles).toContain("src/data/clubs.json");
        expect(dataFiles).toContain("src/data/handicaps.json");
        expect(dataFiles.length).toBeGreaterThan(60);
    });

    it("leaves the hand-formatted course files alone", () => {
        expect(dataFiles.filter((file) => file.startsWith(HAND_MAINTAINED))).toEqual([]);
    });

    it.each(dataFiles)("%s is formatted as the writers write it", (file) => {
        const raw = readFileSync(file, "utf-8");
        // Comparing the whole text catches indentation, key order and the
        // trailing newline in one assertion.
        expect(raw).toEqual(serializeJson(JSON.parse(raw)));
    });
});
