import { readFileSync } from "fs";

import { glob } from "glob";
import { describe, expect, it } from "vitest";

import { schema as CourseSchema, teeId, withTeeIds, type Course } from "@hector/schemas/src/courses.ts";
import { hectorEventSchema } from "@hector/schemas/src/events.ts";

/**
 * A tee's name, and the two other places that have to agree with it.
 *
 * ## The scorecard is keyed by tee name
 *
 * Per-hole lengths are an object, not a list:
 *
 *     { "hole": 1, "par": 4, "hcp": 7, "lengths": { "White": 302, "Yellow": 275 } }
 *
 * and both `ScorecardHalfTable.astro` and `pages/courses/[slug]/holes/[hole].astro`
 * read it as `hole.lengths?.[tee.name]`. Rename a tee without rekeying the
 * lengths and that lookup answers `undefined` — every length on every scorecard
 * and every hole page renders blank, with nothing thrown and nothing logged.
 *
 * The rename that happened on 2026-09-21 moved 78 tee names and 1,433 length
 * keys, which is the ratio that makes this worth pinning rather than
 * remembering: there is no plausible edit that touches one and not the other by
 * hand.
 *
 * ## Events reference tees by name too
 *
 * A Hector round names a course and a tee. Until 2026-09-21 the two conventions
 * disagreed — events said `White`, course data said `white`, and across all
 * eighteen events and seventeen courses there was not one exact match. Nothing
 * noticed because `RoundsList.astro` compares with `toLowerCase()` on both
 * sides.
 *
 * That comparison stays, because it costs nothing and a round typed by hand is
 * exactly where the next mismatch would come from. What this pins is that it is
 * no longer *load-bearing*: the names agree exactly, so the lowercasing is
 * belt-and-braces rather than the only thing holding the two datasets together.
 *
 * See [`docs/plans/courses-in-the-admin.md`](../../../docs/plans/courses-in-the-admin.md).
 */

const courseFiles = (await glob("src/data/courses/**/*.json")).sort();
const hectorFiles = (await glob("src/data/events/hector/*.json")).sort();

const courses: Course[] = courseFiles.map(
    (file) => CourseSchema.parse(JSON.parse(readFileSync(file, "utf-8"))) as Course,
);

const teesOf = (course: Course) => course.course?.tees ?? [];

describe("tee names in the course data", () => {
    it("has courses and tees to check, so a glob mistake cannot make this vacuous", () => {
        expect(courses.length).toBeGreaterThanOrEqual(17);
        expect(courses.flatMap(teesOf).length).toBeGreaterThanOrEqual(78);
    });

    /**
     * Capitalised, which is the form events already used and the form somebody
     * types. `name_local` is deliberately not checked: `bílá` is Czech prose
     * rather than a key, and nothing looks it up.
     */
    it("start with a capital", () => {
        const lowercase = courses.flatMap((course) =>
            teesOf(course)
                .map((tee) => tee.name)
                .filter((name) => name !== name.charAt(0).toUpperCase() + name.slice(1)),
        );

        expect(lowercase).toEqual([]);
    });

    it("are unique within a course, case included", () => {
        for (const course of courses) {
            const names = teesOf(course).map((tee) => tee.name);
            expect(new Set(names).size, `${course.id} has a duplicate tee name`).toBe(names.length);

            const folded = names.map((name) => name.toLowerCase());
            expect(new Set(folded).size, `${course.id} has tees differing only in case`).toBe(names.length);
        }
    });
});

describe("the scorecard's per-hole lengths", () => {
    /**
     * The one that turns a rename into blank scorecards. Both directions matter
     * and only one of them is obvious: a key with no tee renders nothing, and a
     * tee with no key renders nothing for that tee.
     */
    it("are keyed by a tee name that exists on that course", () => {
        for (const course of courses) {
            const names = new Set(teesOf(course).map((tee) => tee.name));

            for (const side of ["men", "ladies"] as const) {
                for (const hole of course.course?.scorecard?.[side] ?? []) {
                    const lengths = hole.lengths as Record<string, unknown> | undefined;
                    if (!lengths) continue;

                    const orphaned = Object.keys(lengths).filter((key) => !names.has(key));
                    expect(orphaned, `${course.id} hole ${hole.hole} (${side})`).toEqual([]);
                }
            }
        }
    });
});

describe("the tees events ask for", () => {
    /**
     * The mismatch this replaced was invisible for as long as it existed,
     * because the lookup lowercases both sides. Asserting exact agreement is
     * what makes the lowercasing a convenience rather than the mechanism.
     */
    it("match a tee on that course exactly, not only case-insensitively", () => {
        const byId = new Map(courses.map((course) => [course.id, course]));
        let checked = 0;

        for (const file of hectorFiles) {
            const event = hectorEventSchema.parse(JSON.parse(readFileSync(file, "utf-8")));

            for (const round of event.rounds ?? []) {
                const course = byId.get(round.course);
                // A round naming a course with no file is a different problem,
                // and `course-schema-coverage.test.ts` is not it either. Skip
                // rather than fail here: this test is about tee *names*.
                if (!course) continue;

                const names = teesOf(course).map((tee) => tee.name);
                expect(names, `${event.id} round ${round.round} on ${round.course}`).toContain(round.tee);
                checked += 1;
            }
        }

        expect(checked, "no rounds were checked, so this asserted nothing").toBeGreaterThan(0);
    });
});

describe("the tee id, which is not the tee name", () => {
    /**
     * A tee's identity cannot be its name once a name can be edited, and names
     * are exactly the sort of thing that changes: `White` becomes `60`,
     * `Yellow` becomes `Gold`. The id is derived once, from the name the tee was
     * born with, and never recomputed — so it *looks* like that first name and
     * must not be read as the current one.
     */
    it("is a slug of the name it was derived from", () => {
        expect(teeId("White")).toBe("white");
        expect(teeId("  Gold  ")).toBe("gold");
        expect(teeId("60")).toBe("60");
        expect(teeId("Back Tee")).toBe("back-tee");
    });

    it("is unique within every course, which is what makes it usable as a key", () => {
        for (const course of courses) {
            const ids = teesOf(course).map((tee) => teeId(tee.name));
            expect(new Set(ids).size, `${course.id} derives a duplicate tee id`).toBe(ids.length);
        }
    });

    /**
     * The seed calls this on the way in. Idempotence matters because the seed
     * runs after every scheduled update: a second pass must not renumber a tee
     * that has since been renamed in the admin, or every reference to it breaks
     * at once.
     */
    it("leaves an id that already exists alone, however the name has changed", () => {
        const course = courses.find((c) => teesOf(c).length > 0)!;
        const once = withTeeIds(course);
        const renamed: Course = {
            ...once,
            course: {
                ...once.course!,
                tees: once.course!.tees.map((tee) => ({ ...tee, name: `${tee.name} Renamed` })),
            },
        };

        expect(withTeeIds(renamed).course!.tees.map((tee) => tee.id)).toEqual(
            once.course!.tees.map((tee) => tee.id),
        );
    });

    it("gives every tee an id, and changes nothing else about the course", () => {
        for (const course of courses) {
            const enriched = withTeeIds(course);
            expect(enriched.course?.tees.every((tee) => tee.id)).not.toBe(false);
            expect({ ...enriched, course: undefined }).toEqual({ ...course, course: undefined });
            expect(enriched.course?.tees.map((tee) => tee.name)).toEqual(
                teesOf(course).map((tee) => tee.name),
            );
        }
    });
});
