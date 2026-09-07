import { expect, describe, it } from "vitest";

import {
    playingHandicapFor,
    stablefordPoints,
    strokesReceived,
    totalStableford,
} from "../../../src/code/mscorecard/scoring.ts";

/**
 * Tapiola Golf, from the par tables the API embeds in a round.
 *
 * The two nines are the same total par but differently shaped, which is what makes
 * them useful here: the 2nd is a par 3 and the 11th a par 5.
 *
 * A word on the stroke indexes, because they are not what you might expect. Within
 * any one card mScorecard gives one nine the odd indexes 1-17 and the other the even
 * 2-18, and it renumbers them per configuration. These two fixtures are each nine
 * played *on its own* as a nine-hole round — `parIndex_1_1` and `parIndex_2_2` — so
 * both come out odd, each being the first nine of its own card. In Tapiola's
 * standard 18-hole routing it is the other way round for nine 1; see TAPIOLA_18.
 *
 * None of that affects scoring: strokes are handed out hardest hole first, so only
 * the ranking within the nine matters, never the numbers themselves.
 */
const NINE_1_ALONE = {
    pars: [5, 3, 4, 3, 5, 4, 4, 4, 4],
    indexes: [13, 17, 11, 7, 5, 9, 3, 15, 1],
};
const NINE_2_ALONE = {
    pars: [4, 5, 4, 3, 4, 4, 4, 4, 4],
    indexes: [3, 17, 11, 9, 15, 1, 7, 13, 5],
};

/**
 * The same course as an ordinary 18-hole round (`parIndex_1_2`).
 *
 * Here nine 1 carries the even indexes and nine 2 the odd ones — the reverse of the
 * usual convention, and the reverse of what nine 1 gets when played alone. Every one
 * of its indexes is exactly one higher than in NINE_1_ALONE, so the ranking of the
 * holes is untouched.
 */
const TAPIOLA_18 = {
    pars: [5, 3, 4, 3, 5, 4, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4, 4],
    indexes: [14, 18, 12, 8, 6, 10, 4, 16, 2, 3, 17, 11, 9, 15, 1, 7, 13, 5],
};

/** A course handicap of 15 is an eighteen-hole allowance: about eight over nine. */
const PLAYING_HCP_9 = playingHandicapFor(15, 9);

describe("Stableford scoring", () => {
    describe("converting a course handicap to the holes being played", () => {
        it("leaves an eighteen-hole round alone", () => {
            expect(playingHandicapFor(15, 18)).toEqual(15);
        });

        it("halves it for nine holes", () => {
            // 15 strokes per 18 holes is 7.5 per nine, so 8.
            expect(playingHandicapFor(15, 9)).toEqual(8);
            expect(playingHandicapFor(14, 9)).toEqual(7);
            expect(playingHandicapFor(0, 9)).toEqual(0);
        });
    });

    describe("strokes received", () => {
        it("spreads the allowance evenly and gives the remainder to the hardest holes", () => {
            // Eight strokes over nine holes: one on all but the easiest.
            const received = strokesReceived(NINE_2_ALONE.indexes, PLAYING_HCP_9);

            expect(received).toHaveLength(9);
            expect(received.filter((s) => s === 1)).toHaveLength(8);
            // Index 17 is the easiest of these nine, so it misses out.
            expect(received[NINE_2_ALONE.indexes.indexOf(17)]).toEqual(0);
            expect(received[NINE_2_ALONE.indexes.indexOf(1)]).toEqual(1);
        });

        it("gives a second stroke on the hardest holes once past one per hole", () => {
            // 20 over 18 holes: one everywhere, a second on the two hardest.
            const received = strokesReceived(TAPIOLA_18.indexes, 20);

            expect(received.filter((s) => s === 2)).toHaveLength(2);
            expect(received.filter((s) => s === 1)).toHaveLength(16);
        });

        it("gives one stroke per hole and no more at exactly nine", () => {
            expect(strokesReceived(NINE_2_ALONE.indexes, 9)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
        });

        it("gives nothing off scratch", () => {
            expect(strokesReceived(NINE_2_ALONE.indexes, 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        });

        it("takes strokes back from the easiest holes on a plus handicap", () => {
            const received = strokesReceived(NINE_2_ALONE.indexes, -2);

            expect(received.filter((s) => s === -1)).toHaveLength(2);
            // Index 17 and 15 are the two easiest of this nine.
            expect(received[NINE_2_ALONE.indexes.indexOf(17)]).toEqual(-1);
            expect(received[NINE_2_ALONE.indexes.indexOf(15)]).toEqual(-1);
            expect(received[NINE_2_ALONE.indexes.indexOf(1)]).toEqual(0);
        });
    });

    describe("odd and even stroke indexes", () => {
        it("hands out strokes on ranking alone, so renumbering changes nothing", () => {
            // Nine 1 is odd played alone and even inside the 18-hole card, each index
            // exactly one higher. Same holes, same order of difficulty.
            const inTheCard = TAPIOLA_18.indexes.slice(0, 9);
            expect(inTheCard).toEqual(NINE_1_ALONE.indexes.map((index) => index + 1));

            expect(strokesReceived(inTheCard, 4)).toEqual(strokesReceived(NINE_1_ALONE.indexes, 4));
            expect(strokesReceived(inTheCard, 8)).toEqual(strokesReceived(NINE_1_ALONE.indexes, 8));
        });

        it("keeps nine 2's indexes identical whether played alone or as the back nine", () => {
            expect(TAPIOLA_18.indexes.slice(9)).toEqual(NINE_2_ALONE.indexes);
        });

        it("splits the 18-hole card into odd and even nines", () => {
            const front = TAPIOLA_18.indexes.slice(0, 9);
            const back = TAPIOLA_18.indexes.slice(9);

            // At Tapiola it is nine 2 that carries the odd indexes, including the
            // stroke index 1 hole. Which nine gets which varies by course.
            expect(front.every((index) => index % 2 === 0)).toBe(true);
            expect(back.every((index) => index % 2 === 1)).toBe(true);
            expect(back).toContain(1);
        });

        it("scores a full 18-hole round off the real card", () => {
            const card = [5, 4, 5, 3, 6, 5, 4, 5, 5, 6, 7, 4, 4, 7, 6, 6, 5, 5];

            const points = stablefordPoints(card, TAPIOLA_18.pars, TAPIOLA_18.indexes, 15);

            expect(points).toHaveLength(18);
            expect(strokesReceived(TAPIOLA_18.indexes, 15).filter((s) => s === 1)).toHaveLength(15);
            expect(totalStableford(card, TAPIOLA_18.pars, TAPIOLA_18.indexes, 15)).toEqual(
                points.reduce((sum, value) => sum + value, 0),
            );
        });
    });

    describe("points", () => {
        it("scores two for a net par and one more per stroke better", () => {
            const pars = [4, 4, 4, 4, 4, 4, 4, 4, 4];
            const indexes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            //            eagle bogey par  birdie  triple  double  albatross...
            const gross = [2, 5, 4, 3, 7, 6, 1, 4, 4];

            expect(stablefordPoints(gross, pars, indexes, 0)).toEqual([4, 1, 2, 3, 0, 0, 5, 2, 2]);
        });

        it("scores nothing for a hole that was not played", () => {
            const gross = [4, -1, -1, -1, -1, -1, -1, -1, -1];

            // The 10th is stroke index 3, so it receives one of the eight strokes: a
            // gross 4 is a net 3 on a par 4, a birdie, worth three points.
            expect(stablefordPoints(gross, NINE_2_ALONE.pars, NINE_2_ALONE.indexes, PLAYING_HCP_9)).toEqual([
                3, 0, 0, 0, 0, 0, 0, 0, 0,
            ]);
        });
    });

    /**
     * The case that motivates checking points rather than raw arrays: identical
     * strokes on the same stroke index, scoring differently purely because the pars
     * differ.
     */
    describe("telling Tapiola's two nines apart", () => {
        it("scores six strokes on the 11th as a bogey, and on the 2nd as nothing", () => {
            const six = [-1, 6, -1, -1, -1, -1, -1, -1, -1];

            const onTheBack = stablefordPoints(six, NINE_2_ALONE.pars, NINE_2_ALONE.indexes, PLAYING_HCP_9);
            const onTheFront = stablefordPoints(six, NINE_1_ALONE.pars, NINE_1_ALONE.indexes, PLAYING_HCP_9);

            // Stroke index 17 is the easiest hole of either nine, so with only eight
            // strokes to give out it receives none.
            expect(strokesReceived(NINE_2_ALONE.indexes, PLAYING_HCP_9)[1]).toEqual(0);
            // 11th: par 5, gross 6, a bogey.
            expect(onTheBack[1]).toEqual(1);
            // 2nd: par 3, gross 6, three over.
            expect(onTheFront[1]).toEqual(0);
        });

        it("gives a whole card a different shape on the wrong nine", () => {
            const card = [6, 7, 4, 4, 7, 6, 6, 5, 5];

            const onTheBack = stablefordPoints(card, NINE_2_ALONE.pars, NINE_2_ALONE.indexes, PLAYING_HCP_9);
            const onTheFront = stablefordPoints(card, NINE_1_ALONE.pars, NINE_1_ALONE.indexes, PLAYING_HCP_9);
            const differing = onTheBack.filter((points, hole) => points !== onTheFront[hole]).length;

            // Three holes differ in par, but only two score differently: on the
            // first, the front nine's extra par comes with an easier stroke index,
            // and the stroke it loses cancels the shot it gains. A par difference is
            // not enough on its own — which is why the self-test compares points per
            // hole rather than assuming pars tell the whole story.
            expect(differing).toEqual(2);
            expect(totalStableford(card, NINE_2_ALONE.pars, NINE_2_ALONE.indexes, PLAYING_HCP_9)).toEqual(12);
            expect(totalStableford(card, NINE_1_ALONE.pars, NINE_1_ALONE.indexes, PLAYING_HCP_9)).toEqual(14);
        });
    });
});
