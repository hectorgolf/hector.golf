import { expect, describe, it } from "vitest";

import {
    countedCard,
    countedStrokes,
    DEFAULT_MAX_STROKES_OVER_PAR,
    isCapped,
    maxStrokesOnHole,
    maxStrokesOverParFor,
} from "../../src/code/scoring.ts";
import { stablefordPoints, totalStableford } from "../../src/code/mscorecard/scoring.ts";
import { hectorEventSchema } from "../../src/schemas/events.ts";

describe("Maximum score per hole", () => {
    describe("the cap itself", () => {
        it("is par plus four by default", () => {
            expect(DEFAULT_MAX_STROKES_OVER_PAR).toEqual(4);
            expect(maxStrokesOnHole(4)).toEqual(8);
            expect(maxStrokesOnHole(3)).toEqual(7);
            expect(maxStrokesOnHole(5)).toEqual(9);
        });

        it("counts a 10 on a par 4 as an 8", () => {
            expect(countedStrokes(10, 4)).toEqual(8);
        });

        it("leaves a score at or under the cap alone", () => {
            expect(countedStrokes(8, 4)).toEqual(8);
            expect(countedStrokes(4, 4)).toEqual(4);
            expect(countedStrokes(2, 4)).toEqual(2);
        });

        it("takes a different cap when the event says so", () => {
            // par+5 is the other one used in practice.
            expect(countedStrokes(10, 4, 5)).toEqual(9);
            expect(countedStrokes(10, 4, 10)).toEqual(10);
        });

        it("leaves a hole with no score unentered rather than inventing one", () => {
            // A cap is a maximum, not a default.
            expect(countedStrokes(-1, 4)).toEqual(-1);
            expect(countedStrokes(0, 4)).toEqual(0);
        });

        it("says which holes it changed, for explaining a total", () => {
            expect(isCapped(10, 4)).toBe(true);
            expect(isCapped(8, 4)).toBe(false);
            expect(isCapped(-1, 4)).toBe(false);
        });
    });

    describe("a whole card", () => {
        const pars = [4, 3, 4, 5, 4, 4, 4, 3, 5];

        it("caps each hole against its own par", () => {
            const marked = [10, 10, 10, 10, 4, 4, 4, 4, 4];

            // Eight on the par 4s, seven on the par 3, nine on the par 5.
            expect(countedCard(marked, pars)).toEqual([8, 7, 8, 9, 4, 4, 4, 4, 4]);
        });

        it("leaves an honest card untouched", () => {
            const marked = [5, 4, 4, 6, 4, 5, 4, 3, 6];

            expect(countedCard(marked, pars)).toEqual(marked);
        });

        it("leaves holes it has no par for alone rather than guessing", () => {
            // A card and a course disagreeing about hole count is a bug worth seeing.
            expect(countedCard([10, 10], [4])).toEqual([8, 10]);
        });
    });

    /**
     * The point of the cap: a blow-up hole scores as though it were marked at the
     * maximum, so an honest 10 and a capped 8 come to the same total.
     *
     * Note where it can and cannot bite. Stableford already gives no points for
     * anything worse than a net bogey, so on a hole receiving two strokes or fewer a
     * par+4 score is worth nothing either way and the cap changes nothing. It only
     * rescues points where three or more strokes are received — which is to say, for
     * exactly the high handicappers the rule exists to keep honest.
     */
    describe("scoring a card with the cap applied", () => {
        const pars = [4, 3, 4, 5, 4, 4, 4, 3, 5];
        const indexes = [3, 17, 11, 9, 15, 1, 7, 13, 5];
        /** Position 5 is stroke index 1, the hardest hole of the nine. */
        const hardest = indexes.indexOf(1);
        /** Nineteen over nine holes is three strokes on the hardest hole, two elsewhere. */
        const bigHandicap = 19;

        /** A level-par card with one blow-up hole. */
        const cardWith = (strokes: number) => {
            const card = [...pars];
            card[hardest] = strokes;
            return card;
        };

        it("scores a marked 10 exactly as a marked 8", () => {
            expect(stablefordPoints(cardWith(10), pars, indexes, bigHandicap, 4)).toEqual(
                stablefordPoints(cardWith(8), pars, indexes, bigHandicap, 4),
            );
        });

        it("makes a difference the marked card would have lost", () => {
            // Without the cap those two cards score differently; with it they do not.
            expect(stablefordPoints(cardWith(10), pars, indexes, bigHandicap)).not.toEqual(
                stablefordPoints(cardWith(8), pars, indexes, bigHandicap),
            );
        });

        it("rescues the point on a hole receiving three strokes", () => {
            const marked = stablefordPoints(cardWith(10), pars, indexes, bigHandicap);
            const capped = stablefordPoints(cardWith(10), pars, indexes, bigHandicap, 4);

            expect(marked[hardest]).toEqual(0);
            expect(capped[hardest]).toEqual(1);
            expect(totalStableford(cardWith(10), pars, indexes, bigHandicap, 4)).toEqual(
                totalStableford(cardWith(10), pars, indexes, bigHandicap) + 1,
            );
        });

        it("changes nothing where only two strokes are received", () => {
            // A net double bogey scores zero whether it was marked as 8 or as 10, so
            // for most players on most holes the cap is invisible.
            const modest = 18; // two strokes on every hole of the nine

            expect(stablefordPoints(cardWith(10), pars, indexes, modest, 4)).toEqual(
                stablefordPoints(cardWith(10), pars, indexes, modest),
            );
        });

        it("does not touch a card that never exceeds the cap", () => {
            const honest = [5, 4, 4, 6, 4, 5, 4, 3, 6];

            expect(stablefordPoints(honest, pars, indexes, bigHandicap, 4)).toEqual(
                stablefordPoints(honest, pars, indexes, bigHandicap),
            );
        });

        it("takes the card as marked when no cap is given", () => {
            // The SDK is a mScorecard client, not a Hector one: a casual round plays
            // no maximum, so the cap has to be asked for.
            const marked = cardWith(10);

            expect(stablefordPoints(marked, pars, indexes, bigHandicap)).toEqual(
                stablefordPoints(marked, pars, indexes, bigHandicap, 99),
            );
        });
    });

    describe("configuring it per event, and per round when it differs", () => {
        const round = (over: Record<string, unknown> = {}) => ({
            day: 1,
            round: 1,
            course: "konopiste-radecky",
            tee: "Yellow",
            gameFormats: [{ format: "Stableford NET" }],
            ...over,
        });

        const event = (over: Record<string, unknown> = {}) => ({
            id: "HECTOR2026",
            format: "hector",
            name: "Hector Trophée 2026",
            location: "Konopiště",
            date: "September 24–27, 2026",
            participants: [],
            rounds: [round()],
            ...over,
        });

        const parse = (over: Record<string, unknown> = {}) => hectorEventSchema.parse(event(over));

        it("defaults to par plus four when the event does not say", () => {
            expect(parse().maxStrokesOverPar).toEqual(4);
        });

        it("takes the event's own value", () => {
            expect(parse({ maxStrokesOverPar: 5 }).maxStrokesOverPar).toEqual(5);
        });

        it("leaves a round's own value absent unless it sets one", () => {
            // Absent means "whatever the event plays", so it carries no default of
            // its own — a default here would be indistinguishable from an override.
            expect(parse().rounds?.[0]?.maxStrokesOverPar).toBeUndefined();
        });

        it("keeps a round's override", () => {
            const parsed = parse({ rounds: [round({ maxStrokesOverPar: 6 })] });

            expect(parsed.rounds?.[0]?.maxStrokesOverPar).toEqual(6);
        });

        it("validates a round's override the same way as the event's", () => {
            for (const bad of [0, -1, 4.5, 10]) {
                expect(() => parse({ rounds: [round({ maxStrokesOverPar: bad })] })).toThrow();
                expect(() => parse({ maxStrokesOverPar: bad })).toThrow();
            }
        });

        describe("resolving which one applies", () => {
            it("plays the event's rule when the round says nothing", () => {
                const parsed = parse({ maxStrokesOverPar: 5 });

                expect(maxStrokesOverParFor(parsed, parsed.rounds?.[0])).toEqual(5);
            });

            it("lets a round depart from it", () => {
                const parsed = parse({ maxStrokesOverPar: 5, rounds: [round({ maxStrokesOverPar: 8 })] });

                expect(maxStrokesOverParFor(parsed, parsed.rounds?.[0])).toEqual(8);
            });

            it("falls back to the event when handed no round at all", () => {
                expect(maxStrokesOverParFor(parse())).toEqual(4);
            });
        });
    });
});
