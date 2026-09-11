/**
 * Hector scoring rules that apply to a card however it was recorded.
 *
 * Pure functions over per-hole numbers: no event loading, no network, nothing to
 * mock. Whatever ends up reading scorecards — the mScorecard SDK, a spreadsheet
 * import, a future scoring engine — can apply these to the same effect.
 */

import type { HectorGameFormatName } from "@hector/schemas/src/events.ts";

/**
 * Which game formats a maximum score per hole is shown as a rule of.
 *
 * Plain Stableford is left out because it caps the damage itself: a hole worse than
 * a net bogey already scores nothing, and a player who cannot score picks the ball
 * up and walks to the next tee.
 *
 * Not *quite* nothing, strictly. On a hole where a player receives three strokes, a
 * par+4 cap turns a marked 10 into an 8 and hands over a point the round did not
 * earn. Three strokes on one hole needs a playing handicap of 37 over eighteen, and
 * a Hector field of WHS indexes under 20 comes nowhere near it, so the exception is
 * unreachable rather than merely unlikely.
 *
 * Deliberately a total mapping rather than a list or a name test. Adding a format to
 * the schema will not compile until someone has decided which side it falls on,
 * which is the only way this stays correct — "contains Stableford" would get Better
 * Ball Stableford wrong, and wrong in the generous direction.
 */
const MAXIMUM_SCORE_APPLIES: Record<HectorGameFormatName, boolean> = {
    "Stableford NET": false,
    "Stableford SCR": false,
    "Scramble Stableford NET": false,

    "Stroke Play NET": true,
    "Stroke Play SCR": true,
    "Better Ball Stroke Play NET": true,
    "Better Ball Stroke Play SCR": true,
    "Better Ball Stableford NET": true,
    "Better Ball Stableford SCR": true,
    "Scramble Stroke Play NET": true,
};

/** Whether a maximum score per hole is one of this format's rules. */
export function hasMaximumScorePerHole(format: HectorGameFormatName): boolean {
    return MAXIMUM_SCORE_APPLIES[format] ?? false;
}

/** `-1` is how a hole with no score entered is spelled, following mScorecard. */
const NOT_PLAYED = -1;

/** The default maximum score per hole in a Hector event: par plus four. */
export const DEFAULT_MAX_STROKES_OVER_PAR = 4;

/**
 * The maximum a round actually plays.
 *
 * The event sets the rule and a round may depart from it. A round that says nothing
 * plays the event's, which is the case for almost all of them.
 *
 * Typed structurally rather than against the event schema, so this module stays what
 * it is: arithmetic over numbers, with nothing to load and nothing to mock.
 */
export function maxStrokesOverParFor(
    event: { maxStrokesOverPar: number },
    round?: { maxStrokesOverPar?: number },
): number {
    return round?.maxStrokesOverPar ?? event.maxStrokesOverPar;
}

/**
 * The highest score that counts on one hole.
 *
 * On a par 4 with the default cap, that is 8.
 */
export function maxStrokesOnHole(par: number, overPar: number = DEFAULT_MAX_STROKES_OVER_PAR): number {
    return par + overPar;
}

/**
 * What a hole's score counts as, once the maximum per hole is applied.
 *
 * A player who marked their honest 10 on a par 4 is scored as though they had marked
 * an 8. Nothing is rewritten: this is how a card is *read*, and what was marked stays
 * marked wherever it was recorded.
 *
 * A hole with no score entered stays unentered — a cap cannot invent a score — and a
 * score at or under the cap is returned untouched.
 */
export function countedStrokes(
    strokes: number,
    par: number,
    overPar: number = DEFAULT_MAX_STROKES_OVER_PAR,
): number {
    if (strokes === NOT_PLAYED || strokes <= 0) return strokes;
    return Math.min(strokes, maxStrokesOnHole(par, overPar));
}

/**
 * A whole card as it counts.
 *
 * Holes beyond the end of `pars` are left alone rather than guessed at: a card and a
 * course that disagree about how many holes there are is a bug worth seeing, not one
 * worth silently papering over.
 */
export function countedCard(
    gross: readonly number[],
    pars: readonly number[],
    overPar: number = DEFAULT_MAX_STROKES_OVER_PAR,
): number[] {
    return gross.map((strokes, hole) => {
        const par = pars[hole];
        return par === undefined ? strokes : countedStrokes(strokes, par, overPar);
    });
}

/**
 * Whether a cap would leave a hole scoring differently from what was marked.
 *
 * Useful for showing a player why their card totals less than they expected.
 */
export function isCapped(
    strokes: number,
    par: number,
    overPar: number = DEFAULT_MAX_STROKES_OVER_PAR,
): boolean {
    return countedStrokes(strokes, par, overPar) !== strokes;
}
