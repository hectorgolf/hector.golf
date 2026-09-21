import { describe, expect, it } from "vitest";

import { applyTeeEdits, withoutTeeIds, withTeeIds, type Course, type CourseTee } from "../src/courses.ts";

/**
 * Editing a course's tees, and the scorecard that has to move with them.
 *
 * Per-hole lengths are an object keyed by tee *name*, and the admin lets a
 * person change that name. So a rename is two edits that must not come apart:
 * the tee's `name`, and every `lengths` key that referred to it. Miss the second
 * and `hole.lengths?.[tee.name]` answers `undefined` for every hole — blank
 * scorecards, nothing thrown, nothing logged. `course-tee-names.test.ts` pins
 * the committed data; this pins the function that keeps it that way.
 *
 * **Matching is by `id`, and that is what ids are for.** A tee's name is both
 * the scorecard's key and the thing being edited, so after a rename nothing else
 * can say which old name became which new one. The id is derived once from the
 * name a tee was born with and never recomputed, which is what makes it able to
 * survive the rename it is being used to describe.
 */

const tee = (over: Partial<CourseTee> & { name: string }): CourseTee => ({
    color: "#ffffff",
    length: 6000,
    par: 72,
    rating: { men: 72, ladies: null },
    slope: { men: 130, ladies: null },
    ...over,
});

const course = (tees: CourseTee[], lengths: Record<string, number>): Course =>
    withTeeIds({
        id: "test-course",
        name: "Test Course",
        homepage: "https://example.com",
        contact: { address: "Somewhere" },
        description_short: "A course.",
        description_long: [],
        images: {},
        datasources: [],
        course: {
            tees,
            scorecard: {
                men: [{ hole: 1, par: 4, hcp: 7, lengths: { ...lengths } }],
            },
        },
    } as Course);

const lengthsOf = (result: Course) => result.course!.scorecard.men[0]!.lengths as Record<string, number>;
const teesOf = (result: Course) => result.course!.tees;

describe("renaming a tee", () => {
    const stored = course([tee({ name: "White" }), tee({ name: "Yellow" })], { White: 302, Yellow: 275 });

    it("moves the scorecard's key with it", () => {
        const edited = teesOf(stored).map((t) => (t.name === "White" ? { ...t, name: "Gold" } : t));
        const result = applyTeeEdits(stored, edited);

        expect(teesOf(result).map((t) => t.name)).toEqual(["Gold", "Yellow"]);
        expect(lengthsOf(result)).toEqual({ Gold: 302, Yellow: 275 });
    });

    it("keeps the id it was born with, so the next rename still resolves", () => {
        const edited = teesOf(stored).map((t) => (t.name === "White" ? { ...t, name: "Gold" } : t));
        const once = applyTeeEdits(stored, edited);

        expect(teesOf(once)[0]!.id).toBe("white");

        const twice = applyTeeEdits(once, teesOf(once).map((t) => (t.name === "Gold" ? { ...t, name: "60" } : t)));
        expect(teesOf(twice)[0]!.id).toBe("white");
        expect(lengthsOf(twice)).toEqual({ "60": 302, Yellow: 275 });
    });

    /**
     * The case a naive implementation gets wrong. Rewriting keys in place would
     * have White's 302 land on Yellow and then be overwritten — or survive,
     * depending on iteration order, which is worse. Every key is read from the
     * original object and written into a fresh one.
     */
    it("handles two tees swapping names", () => {
        const edited = teesOf(stored).map((t) => ({ ...t, name: t.name === "White" ? "Yellow" : "White" }));
        const result = applyTeeEdits(stored, edited);

        expect(lengthsOf(result)).toEqual({ Yellow: 302, White: 275 });
    });

    it("leaves a tee nobody renamed alone", () => {
        const result = applyTeeEdits(stored, teesOf(stored));
        expect(lengthsOf(result)).toEqual({ White: 302, Yellow: 275 });
    });
});

describe("adding and removing tees", () => {
    const stored = course([tee({ name: "White" }), tee({ name: "Yellow" })], { White: 302, Yellow: 275 });

    /**
     * A removed tee's lengths go with it. Left behind they would be a key no tee
     * matches, which `course-tee-names.test.ts` fails on — correctly, since it is
     * the same shape as the orphan a bad rename leaves.
     */
    it("drops the lengths of a tee that was removed", () => {
        const result = applyTeeEdits(stored, [teesOf(stored)[0]!]);

        expect(teesOf(result).map((t) => t.name)).toEqual(["White"]);
        expect(lengthsOf(result)).toEqual({ White: 302 });
    });

    /**
     * A new tee has no lengths and cannot be given any here: nobody has measured
     * the holes from it. The scorecard simply has no key for it, and the course
     * page renders an em dash.
     */
    it("gives a new tee an id and leaves the scorecard without it", () => {
        const added = [...teesOf(stored), tee({ name: "Black" })];
        const result = applyTeeEdits(stored, added);

        expect(teesOf(result).map((t) => t.id)).toEqual(["white", "yellow", "black"]);
        expect(lengthsOf(result)).toEqual({ White: 302, Yellow: 275 });
    });

    it("can remove one and rename another in the same edit", () => {
        const edited = [{ ...teesOf(stored)[1]!, name: "Gold" }];
        const result = applyTeeEdits(stored, edited);

        expect(teesOf(result).map((t) => t.name)).toEqual(["Gold"]);
        expect(lengthsOf(result)).toEqual({ Gold: 275 });
    });
});

describe("what the export writes", () => {
    /**
     * Names, not ids. The committed files are what the site reads and what a
     * round's `tee` matches on, and an id in one would be a token nobody can
     * read in a file people still open by hand.
     */
    it("strips the ids the store carries", () => {
        const stored = course([tee({ name: "White" })], { White: 302 });
        expect(teesOf(stored)[0]!.id).toBe("white");

        const exported = withoutTeeIds(stored);
        expect(teesOf(exported)[0]).not.toHaveProperty("id");
        expect(teesOf(exported)[0]!.name).toBe("White");
    });

    it("changes nothing else about the course", () => {
        const stored = course([tee({ name: "White" })], { White: 302 });
        const exported = withoutTeeIds(stored);

        expect({ ...exported, course: undefined }).toEqual({ ...stored, course: undefined });
        expect(exported.course!.scorecard).toEqual(stored.course!.scorecard);
    });
});
