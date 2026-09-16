import { readFileSync } from "fs";

import { glob } from "glob";
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
 * ## The one exception
 *
 * `konopiste-radecky.json` carries `description_deste` — a paragraph about the
 * *d'Este* course, in the *Radecký* course's file, which `konopiste-deste.json`
 * does not contain and no page renders. It is a copy-paste leftover rather than
 * a field, so the fix is to delete it from the data, not to describe it in the
 * schema. It is listed here so that the test passes today and starts failing the
 * moment somebody does delete it — at which point this block comes out too.
 */

const KNOWN_STRAY: Record<string, string[]> = {
    "konopiste-radecky.json": ["description_deste"],
};

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

const files = (await glob("src/data/courses/**/*.json")).sort();

describe("the course schema", () => {
    it("has course files to check, so a glob mistake cannot make this vacuous", () => {
        expect(files.length).toBeGreaterThanOrEqual(17);
    });

    it.each(files)("reads every field in %s", (file) => {
        const raw = JSON.parse(readFileSync(file, "utf-8"));
        const parsed = CourseSchema.safeParse(raw);
        expect(parsed.success).toBe(true);

        const kept = leafPaths(parsed.data);
        const stray = KNOWN_STRAY[file.split("/").pop() ?? ""] ?? [];
        const dropped = [...leafPaths(raw)]
            .filter((path) => !kept.has(path))
            // A stray entry covers the field and anything nested under it.
            .filter((path) => !stray.some((known) => path === known || path.startsWith(`${known}.`)));

        expect(dropped).toEqual([]);
    });
});
