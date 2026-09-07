/**
 * Which nines a course can be played in, and everything that follows from that.
 *
 * Kept apart from the rest of the CLI because it is pure: give it a course object
 * and it answers without touching the network, which makes it testable.
 */

import type { Course, NineSelection, ParIndex, Tee, TeeRatings } from "../types.ts";
import { sum } from "./util.ts";

export const HOLES_PER_NINE = 9;

/**
 * One playable nine configuration, with everything that follows from it.
 *
 * `nine1` and `nine2` are nine *indexes*, not booleans: `nine1` is the nine played
 * on the front half of the card and `nine2` the one on the back half, with 0
 * meaning "no nine here". So the back nine played alone is `nine1: 2, nine2: 0`.
 */
export type NineConfiguration = {
    nine1: NineSelection;
    nine2: NineSelection;
    label: string;
    /** 9 or 18. */
    holes: number;
    /** Course hole number for each position on the card. A back nine plays 10-18. */
    holeNumbers: number[];
    /** Par per position on the card, used as the default scorecard. */
    pars: number[];
    /** Which `ratings_<a>_<b>` on a tee applies to this configuration. */
    ratingsKey: string;
};

/**
 * Every nine configuration this course can be played in.
 *
 * The course tells us which ones exist rather than us guessing: it publishes a
 * `parIndex_<a>_<b>` for each rated combination, so a two-nine course yields 1_1,
 * 1_2 and 2_2.
 *
 * A two-nine course publishes only the ascending pairs, because a rating depends on
 * which eighteen holes you play rather than the order; a three-nine course such as
 * Nevas Golf publishes all nine, reversed keys included, with the reversed ones
 * identical in value. Either way both directions are playable — clubs routinely send
 * crossover starts out from the tenth — so each mixed pair is offered both ways and
 * the reversed one falls back to the ascending rating when it has none of its own.
 *
 * Two caveats. No captured round has `nine1 > nine2`, so reversed play is inferred
 * at the round level; if the server rejects it, play the ascending order instead.
 * And on a multi-nine facility the course ID stands for one particular pair even
 * though its detail rates every combination, so if a combination outside that pair
 * is refused, pick the course whose name matches the nines you want.
 */
export function playableConfigurations(course: Course): NineConfiguration[] {
    const rated = ratedPairs(course);
    const nines = [...new Set(rated.flatMap(({ a, b }) => [a, b]))].sort();

    // Both ways round for each mixed pair. A three-nine course already publishes the
    // reversed keys, so this is deduplicated by ordered pair rather than appended —
    // otherwise Nevas Golf would offer every mixed combination twice.
    const byOrderedPair = new Map<string, NineConfiguration>();
    for (const nine of nines) byOrderedPair.set(`${nine}_0`, configure(course, nine, 0));
    for (const { a, b } of rated) {
        byOrderedPair.set(`${a}_${b}`, configure(course, a, b));
        byOrderedPair.set(`${b}_${a}`, configure(course, b, a));
    }

    return [...byOrderedPair.values()].sort((x, y) => x.holes - y.holes || x.nine1 - y.nine1 || x.nine2 - y.nine2);
}

/** The `<a>_<b>` pairs the course publishes a par table for. */
export function ratedPairs(course: Course): Array<{ a: number; b: number }> {
    return Object.keys(course).flatMap((key) => {
        const match = /^parIndex_(\d)_(\d)$/.exec(key);
        const table = match ? parIndexFor(course, key) : undefined;
        return match && table?.pars?.length ? [{ a: Number(match[1]), b: Number(match[2]) }] : [];
    });
}

/** Builds one configuration. `second` is 0 for a nine-hole round. */
export function configure(course: Course, first: number, second: number): NineConfiguration {
    return {
        nine1: first as NineSelection,
        nine2: second as NineSelection,
        label: describe(course, first, second),
        holes: second ? 2 * HOLES_PER_NINE : HOLES_PER_NINE,
        holeNumbers: second ? [...holeNumbersOf(first), ...holeNumbersOf(second)] : holeNumbersOf(first),
        // Composed per nine rather than sliced out of the combination table, so the
        // halves come out in the order they are actually played.
        pars: second ? [...parsOfNine(course, first), ...parsOfNine(course, second)] : parsOfNine(course, first),
        ratingsKey: `ratings_${first}_${second || first}`,
    };
}

export function describe(course: Course, first: number, second: number): string {
    if (!second) return `${nineName(course, first)} only`;
    if (first === second) return `${nineName(course, first)} twice`;
    return `${nineName(course, first)} then ${nineName(course, second)}`;
}

/**
 * The nine pars of a single nine.
 *
 * Every par table holds eighteen entries, so a nine's own `_N_N` table gives them
 * directly. Failing that, any table mentioning the nine will do — taking the half
 * that corresponds to the position it occupies in that key.
 */
export function parsOfNine(course: Course, nine: number): number[] {
    const own = parIndexFor(course, `parIndex_${nine}_${nine}`);
    if (own?.pars?.length) return own.pars.slice(0, HOLES_PER_NINE);

    for (const key of Object.keys(course)) {
        const match = /^parIndex_(\d)_(\d)$/.exec(key);
        const pars = match ? parIndexFor(course, key)?.pars : undefined;
        if (!match || !pars?.length) continue;
        if (Number(match[1]) === nine) return pars.slice(0, HOLES_PER_NINE);
        if (Number(match[2]) === nine) return pars.slice(HOLES_PER_NINE, 2 * HOLES_PER_NINE);
    }
    return new Array(HOLES_PER_NINE).fill(4); // nothing published; a plausible card
}

/** "front nine" / "back nine" on a two-nine course, otherwise the nine's own name. */
export function nineName(course: Course, nine: number): string {
    const named = [course.nine1Name, course.nine2Name, course.nine3Name, course.nine4Name][nine - 1];
    if (named) return named;
    if (course.numNines === 2) return nine === 1 ? "front nine" : "back nine";
    return `nine ${nine}`;
}

/** Course hole numbers for a nine: nine 2 covers holes 10-18. */
export function holeNumbersOf(nine: number): number[] {
    const first = (nine - 1) * HOLES_PER_NINE + 1;
    return Array.from({ length: HOLES_PER_NINE }, (_, index) => first + index);
}

/** "holes 10-18 then 1-9" — per half, since a reversed round is not one range. */
export function describeHoles(config: NineConfiguration): string {
    const range = (nine: NineSelection) => {
        const numbers = holeNumbersOf(nine);
        return `${numbers[0]}-${numbers[numbers.length - 1]}`;
    };
    return config.nine2 ? `holes ${range(config.nine1)} then ${range(config.nine2)}` : `holes ${range(config.nine1)}`;
}

export function lengthOf(tee: Tee, config: NineConfiguration): number {
    const nine = (n: NineSelection) => sum(tee.lengths[n - 1] ?? []);
    return nine(config.nine1) + (config.nine2 ? nine(config.nine2) : 0);
}

/**
 * The rating for a configuration.
 *
 * A three-nine course publishes both directions, a two-nine course only the
 * ascending one — and the two are identical in value, so falling back to the
 * ascending key is safe.
 */
export function ratingsFor(tee: Tee, config: NineConfiguration): TeeRatings | undefined {
    const a = config.nine1;
    const b = config.nine2 || config.nine1;
    return tee[`ratings_${a}_${b}`] ?? tee[`ratings_${Math.min(a, b)}_${Math.max(a, b)}`];
}

export function parIndexFor(course: Course, key: string): ParIndex | undefined {
    return (course as unknown as Record<string, ParIndex | undefined>)[key];
}

/** The pars and stroke indexes for the holes a configuration actually plays. */
export function holeTableOf(course: Course | undefined, config: NineConfiguration): ParIndex | undefined {
    if (!course) return undefined;
    const a = config.nine1;
    const b = config.nine2 || config.nine1;
    const table =
        parIndexFor(course, `parIndex_${a}_${b}`) ?? parIndexFor(course, `parIndex_${Math.min(a, b)}_${Math.max(a, b)}`);
    if (!table?.pars?.length) return undefined;
    return { pars: table.pars.slice(0, config.holes), indexes: table.indexes.slice(0, config.holes) };
}
