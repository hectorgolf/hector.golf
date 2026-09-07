/**
 * Stableford scoring.
 *
 * mScorecard stores gross strokes and nothing else — there is no points field in any
 * response — so points are the client's job. That makes them a useful check on a
 * card: points depend on the *par and stroke index of each hole*, so a card written
 * to the wrong holes scores differently even when the strokes themselves are right.
 *
 * Tapiola Golf is a neat illustration. Its 2nd hole is a par 3 and its 11th a par 5,
 * and played as standalone nine-hole rounds both are stroke index 17, the easiest
 * hole of their nine — so off a course handicap of 15 (eight strokes over nine
 * holes) neither receives one. Six strokes there:
 *
 *     11th (par 5, back nine)   6 = bogey     1 point
 *      2nd (par 3, front nine)  6 = par + 3   0 points
 *
 * Same strokes, same stroke index, different points — which is why the self-test
 * compares points and not only the raw array.
 *
 * A note on those indexes: within one card mScorecard gives one nine the odd numbers
 * 1-17 and the other the even 2-18, renumbering per configuration, and which nine
 * gets which varies by course. Tapiola's nine 1 is odd played alone but even inside
 * the 18-hole card, every index exactly one higher. It makes no difference here,
 * because strokes are handed out hardest hole first and only the ranking matters.
 */

import { countedCard } from "../scoring.ts";

/** `-1` is how mScorecard spells "not entered". */
const NOT_PLAYED = -1;

const FULL_ROUND = 18;

/**
 * The strokes a player actually receives over the holes being played.
 *
 * A course handicap is an allowance for eighteen holes, so a nine-hole round is
 * worth about half of it — fifteen becomes eight, not fifteen. mScorecard stores the
 * full eighteen-hole figure on the scorecard even when the round is nine holes, so
 * the conversion is the client's to make.
 *
 * This is the plain proportional form. WHS derives a nine-hole course handicap from
 * half the handicap index against the nine's own rating, which can differ by a
 * stroke; if that matters, compute it from the index and rating instead.
 */
export function playingHandicapFor(courseHandicap: number, holes: number): number {
    if (holes >= FULL_ROUND) return courseHandicap;
    return Math.round((courseHandicap * holes) / FULL_ROUND);
}

/**
 * How many strokes a player receives on each hole.
 *
 * `playingHandicap` is the allowance for *these* holes, not a course handicap: pass
 * eight for a nine-hole round off fifteen, or `playingHandicapFor()` will do the
 * conversion. The allowance is spread evenly and the remainder goes to the hardest
 * holes, so eight over nine holes is one stroke on all but the easiest. A plus
 * handicap works in reverse: strokes are given back, starting from the easiest hole.
 */
export function strokesReceived(strokeIndexes: readonly number[], playingHandicap: number): number[] {
    const holes = strokeIndexes.length;
    if (holes === 0) return [];

    const sign = playingHandicap < 0 ? -1 : 1;
    const total = Math.abs(Math.round(playingHandicap));
    const everyHole = Math.floor(total / holes);
    const remainder = total % holes;

    // `|| 0` keeps a plus handicap from filling the card with -0.
    const received = new Array<number>(holes).fill(everyHole * sign || 0);
    strokeIndexes
        .map((strokeIndex, hole) => ({ strokeIndex, hole }))
        // Hardest first when receiving strokes, easiest first when giving them back.
        .sort((a, b) => (sign > 0 ? a.strokeIndex - b.strokeIndex : b.strokeIndex - a.strokeIndex))
        .slice(0, remainder)
        .forEach(({ hole }) => (received[hole]! += sign));
    return received;
}

/**
 * Stableford points per hole: two for a net par, one more per stroke better, none
 * for anything worse than a net bogey. Holes with no score entered are worth zero.
 */
export function stablefordPoints(
    gross: readonly number[],
    pars: readonly number[],
    strokeIndexes: readonly number[],
    playingHandicap: number,
    /**
     * A maximum score per hole, as strokes over par, applied before anything else.
     *
     * Hector events play one; a casual round does not, so it is left out by default
     * and the card is taken as marked. See `code/scoring.ts` for the rule itself.
     */
    maxStrokesOverPar?: number,
): number[] {
    const received = strokesReceived(strokeIndexes, playingHandicap);
    const counted =
        maxStrokesOverPar === undefined ? gross : countedCard(gross, pars, maxStrokesOverPar);
    return counted.map((strokes, hole) => {
        if (strokes === NOT_PLAYED || strokes <= 0) return 0;
        const net = strokes - (received[hole] ?? 0);
        return Math.max(0, 2 + (pars[hole] ?? 0) - net);
    });
}

export function totalStableford(
    gross: readonly number[],
    pars: readonly number[],
    strokeIndexes: readonly number[],
    playingHandicap: number,
    maxStrokesOverPar?: number,
): number {
    return stablefordPoints(gross, pars, strokeIndexes, playingHandicap, maxStrokesOverPar).reduce(
        (sum, points) => sum + points,
        0,
    );
}
