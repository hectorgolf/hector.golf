import { readFileSync } from "fs";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

import { serializeJson } from "../../src/code/json.ts";
import { hectorEventSchema } from "@hector/schemas/src/events.ts";

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

/**
 * A Hector event file is the same whether it is written parsed or raw.
 *
 * The admin's bucket recompute writes the raw JSON with only `buckets` replaced,
 * so that a default `hectorEventSchema` gains later is not materialised into
 * thirteen files that never carried it — the objection `data-ownership.md` makes
 * to giving `bucketsLocked` a default.
 *
 * This was written when there were two writers and they had to agree: the
 * deleted `update-handicaps.ts` wrote the *parsed* event back, Zod's defaults and
 * all, and a disagreement would have had them reformatting the same file on
 * alternate ticks. One writer is left, so what this pins now is narrower and
 * still worth having: the day the schema gains a default the committed files do
 * not carry, the recompute's next write would introduce it as an unexplained
 * diff, and this fails first and says which field.
 */
describe("Hector event files, as both writers would write them", () => {
    const events = dataFiles.filter((file) => file.startsWith("src/data/events/hector/"));

    it("covers every Hector event", () => {
        expect(events.length).toBeGreaterThan(10);
    });

    it.each(events)("%s survives a round trip through the schema unchanged", (file) => {
        const raw = readFileSync(file, "utf-8");
        expect(serializeJson(hectorEventSchema.parse(JSON.parse(raw)))).toEqual(raw);
    });
});
