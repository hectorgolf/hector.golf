import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { schema as CourseSchema } from "@hector/schemas/src/courses.ts";

/**
 * That the course schema reads everything the course files contain.
 *
 * ## Why this is worth a test
 *
 * Zod strips unknown keys rather than complaining about them, so a field in the
 * data that the schema does not mention is not an error — it is a silent
 * omission. Thirteen of the seventeen course files had one: `images.hero`,
 * `images.aerial`, `par_ladies`, the Czech tee names and 70-odd Finnish hole
 * descriptions across the two Tahko courses. Somebody wrote all of that and the
 * site had never shown any of it.
 *
 * While the files are the source of truth that is merely a waste. It stops being
 * merely a waste the moment anything reads a course *through* the schema and
 * writes the result back somewhere — a migration into Firestore, an export, an
 * admin editor saving a form — because then the schema's blind spot becomes a
 * delete. That is exactly what
 * [`docs/plans/everything-to-firestore.md`](../../docs/plans/everything-to-firestore.md)
 * was about to do, and how this was found.
 *
 * So the rule this pins is: **a field that exists in the data exists in the
 * schema**, optional if only one course has it. Adding a field to a course file
 * without adding it here fails the test rather than quietly doing nothing.
 *
 * ## Read from the snapshot, not from files
 *
 * There are no course files any more —
 * [`docs/plans/everything-to-firestore.md`](../../../docs/plans/everything-to-firestore.md) moved
 * them into Firestore — so this reads the committed snapshot instead. The
 * property is unchanged and the reason for it is stronger: on `main` a lagging
 * schema wasted hand-written text, and here it would delete it, because the
 * snapshot is written *through* the schema-validating migration and the files it
 * came from are gone.
 *
 * `data-snapshot.test.ts` is the neighbouring check and a weaker one: it asserts
 * every course record *parses*. This asserts that parsing keeps everything.
 *
 * ## No exceptions
 *
 * There was one — `konopiste-radecky` carried a `description_deste` paragraph
 * describing the *d'Este* course, which that course's own record does not
 * contain and no page renders. It has been deleted from the data rather than
 * described in the schema, which is what a copy-paste leftover deserves.
 */

/** Every leaf path in an object, as dotted/indexed strings. */
function leafPaths(value: unknown): Set<string> {
    const found = new Set<string>();
    const walk = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
            node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
        } else if (node && typeof node === "object") {
            for (const key of Object.keys(node)) {
                walk((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
            }
        } else {
            found.add(path);
        }
    };
    walk(value, "");
    return found;
}

const snapshot = JSON.parse(readFileSync(join(process.cwd(), "src/data/snapshot.json"), "utf-8"));
const courses = (snapshot.courses as Array<Record<string, unknown>>)
    .map((course) => [String(course.id), course] as const)
    .sort(([a], [b]) => a.localeCompare(b));

describe("the course schema", () => {
    it("has courses to check, so an empty snapshot cannot make this vacuous", () => {
        expect(courses.length).toBeGreaterThanOrEqual(17);
    });

    it.each(courses)("reads every field in %s", (id, raw) => {
        const parsed = CourseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);

        const kept = leafPaths(parsed.data);
        const dropped = [...leafPaths(raw)].filter((path) => !kept.has(path));

        expect(dropped).toEqual([]);
    });
});
