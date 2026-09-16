import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { genericEventSchema } from "@hector/schemas/src/events.ts";
import { schema as CourseSchema } from "@hector/schemas/src/courses.ts";
import { schema as PlayerSchema } from "@hector/schemas/src/players.ts";
import { schema as HandicapSchema } from "@hector/schemas/src/handicaps.ts";
import { schema as HandicapCheckSchema } from "@hector/schemas/src/handicap-checks.ts";

/**
 * The committed fallback snapshot: that it is there, complete, and readable.
 *
 * ## Why this replaces `data-formatting.test.ts`
 *
 * That test held 89 committed data files to one JSON format, because eight
 * different writers had disagreed about indentation and a run that changed one
 * handicap produced a diff of hundreds of lines. There is one data file now and
 * one writer, so the formatting half of that job is nearly done for it — but the
 * *other* half is new and much more important.
 *
 * ## The failure this exists for
 *
 * Deleting `src/data/` broke a data path nobody was looking at:
 * `content.config.ts` pointed Astro's own `glob()` loader at the same
 * directories `data.ts` read, for the pages that use `getCollection()`. With the
 * directories gone the collections were empty, and **nothing failed**.
 * `astro check` passed. The build passed. It produced 77 pages instead of 328 —
 * every course page and all 306 hole pages silently missing — because an empty
 * collection is a legal collection and `getStaticPaths` returning nothing is a
 * legal answer.
 *
 * A build that publishes an empty site while reporting success is the worst
 * outcome available to this migration, and it is reachable from any of: a
 * renamed collection key, a snapshot written by a script that skipped a
 * collection, a schema tightened until nothing parses. So the counts below are
 * asserted as lower bounds rather than left to be noticed in a build log.
 */

const snapshot = JSON.parse(readFileSync(join(process.cwd(), "src/data/snapshot.json"), "utf-8"));

/**
 * What the repository held when the data moved out, per collection.
 *
 * Lower bounds, not equalities: these grow. The point is to catch a collection
 * arriving empty or nearly so, which is the shape of every way this breaks.
 */
const AT_LEAST: Record<string, number> = {
    players: 45,
    events: 18,
    courses: 17,
    leaderboards: 6,
    clubs: 140,
    handicapObservations: 1400,
    handicapChecks: 19,
};

describe("the committed data snapshot", () => {
    it("has every collection the site reads", () => {
        expect(Object.keys(snapshot).sort()).toEqual([...Object.keys(AT_LEAST), "generatedAt"].sort());
    });

    it.each(Object.entries(AT_LEAST))("holds at least %i %s", (collection, minimum) => {
        expect(Array.isArray(snapshot[collection as string])).toBe(true);
        expect((snapshot[collection as string] as unknown[]).length).toBeGreaterThanOrEqual(minimum as number);
    });

    it("is formatted the way the writer writes it", () => {
        // The surviving half of `data-formatting.test.ts`. One file and one
        // writer, but a formatter reaching into `src/data/` would still produce a
        // whole-file diff on every regeneration.
        //
        // Two-space, which is *not* the site's own `serializeJson` convention —
        // that one is four-space, for files a person might read in a diff. This
        // file is generated wholesale and never hand-edited, so it is written
        // with plain `JSON.stringify` and this is the assertion that pins which
        // of the two it is.
        const raw = readFileSync(join(process.cwd(), "src/data/snapshot.json"), "utf-8");
        expect(raw).toEqual(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    });
});

describe("every record in the snapshot still parses", () => {
    // The check `admin/scripts/migrate.ts --check` does against Firestore, done
    // here against the fallback — because the fallback is what a fork, a pull
    // request and `check-site.yml` actually build from.
    const cases: Array<[string, { safeParse: (value: unknown) => { success: boolean } }]> = [
        ["players", PlayerSchema],
        ["events", genericEventSchema],
        ["courses", CourseSchema],
        ["handicapObservations", HandicapSchema],
        ["handicapChecks", HandicapCheckSchema],
    ];

    it.each(cases)("%s", (collection, schema) => {
        const rows = snapshot[collection] as unknown[];
        const rejected = rows.filter((row) => !schema.safeParse(row).success);
        expect(rejected).toEqual([]);
    });
});
