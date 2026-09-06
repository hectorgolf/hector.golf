/**
 * Reading a round back from the API and showing it beside what was meant to go in.
 *
 * Reading it back rather than trusting the write is the whole point: a card can be
 * accepted and still be filed against the wrong holes, and the only way to see that
 * is to ask the server what it kept.
 */

import { MScorecardClient, playingHandicapFor, stablefordPoints } from "../index.ts";
import type { Course, ParIndex } from "../types.ts";
import { holeTableOf, nineName, type NineConfiguration } from "./nines.ts";
import { sum } from "./util.ts";

export type StoredRoundContext = {
    heading: string;
    course: Course;
    config: NineConfiguration;
    intended: readonly number[];
    courseHcp: number;
};

export async function showStoredRound(
    client: MScorecardClient,
    roundID: string,
    context: StoredRoundContext,
): Promise<void> {
    const { heading, course, config, intended, courseHcp } = context;
    const stored = await client.openRound(roundID);
    const slot = stored.players[0];
    if (!slot) {
        console.log(`\n${heading}: the round came back with no players.`);
        return;
    }

    const card = stored.card(slot.sid).slice(0, config.holes);
    const table = holeTableOf(stored.course, config) ?? holeTableOf(course, config);
    const playing = playingHandicapFor(courseHcp, config.holes);

    console.log(`\n--- ${heading} (round ${roundID}) ---`);
    console.log(`  ${slot.name}, course handicap ${slot.courseHcp}, ${playing} strokes over ${config.holes} holes`);

    // The server's own view of which nines this round is on. Everything below is
    // laid out using *our* configuration, so if the server disagrees the table would
    // otherwise look perfectly correct while describing the wrong holes.
    const theirNines = `nine1 ${stored.descriptor.nine1}, nine2 ${stored.descriptor.nine2}`;
    const ourNines = `nine1 ${config.nine1}, nine2 ${config.nine2}`;
    console.log(
        theirNines === ourNines
            ? `  Server agrees this is ${config.label} (${theirNines}).`
            : `  MISMATCH: we asked for ${ourNines}, the server stored ${theirNines}.`,
    );
    if (stored.course?.courseID) {
        console.log(`  Course as stored: ${stored.course.courseID}`);
    }
    if (!table) {
        console.log(`  intended ${intended.join(", ")}`);
        console.log(`  stored   ${card.join(", ")}`);
        return;
    }

    const points = stablefordPoints(card, table.pars, table.indexes, playing);
    console.log("\n  card  hole  par  idx  intended  stored  points");
    card.forEach((stored_strokes, position) => {
        const want = intended[position];
        const flag = stored_strokes === want ? "" : `   <-- expected ${want}`;
        console.log(
            `  ${String(position + 1).padStart(4)}  ${String(config.holeNumbers[position]).padStart(4)}  ` +
                `${String(table.pars[position]).padStart(3)}  ${String(table.indexes[position]).padStart(3)}  ` +
                `${String(want).padStart(8)}  ${String(stored_strokes).padStart(6)}  ` +
                `${String(points[position]).padStart(6)}${flag}`,
        );
    });

    const wrong = card.filter((value, position) => value !== intended[position]).length;
    console.log(
        wrong === 0
            ? `\n  All ${card.length} holes match. ${sum(points)} Stableford points, ${sum(card)} strokes.`
            : `\n  ${wrong} of ${card.length} holes do NOT match what was sent.`,
    );
}

/**
 * Prints the card hole by hole, next to what it would have scored had it landed on
 * the wrong nine.
 *
 * This is where a hole-mapping bug becomes obvious. At Tapiola the 2nd is a par 3
 * and the 11th a par 5, both stroke index 17, so six strokes there is worth two
 * points on the back nine and none on the front. A raw array comparison cannot see
 * that difference; the points can.
 */
export function reportScorecard(
    course: Course,
    config: NineConfiguration,
    card: readonly number[],
    table: ParIndex,
    points: readonly number[],
    playingHandicap: number,
): void {
    const otherNine = config.nine1 === 1 ? 2 : 1;
    const other = holeTableOf(course, { ...config, nine1: otherNine, nine2: config.nine2 ? otherNine : 0 });
    const otherPoints = other ? stablefordPoints(card, other.pars, other.indexes, playingHandicap) : undefined;

    console.log(`\nScorecard as the server has it (${playingHandicap} strokes over ${card.length} holes):`);
    console.log("  card  hole  par  idx  strokes  points" + (other ? `   if on ${nineName(course, otherNine)}` : ""));
    card.forEach((strokes, position) => {
        const alt = other && otherPoints ? `   par ${other.pars[position]} -> ${otherPoints[position]} pts` : "";
        const differs = otherPoints && otherPoints[position] !== points[position] ? "  <-- would differ" : "";
        console.log(
            `  ${String(position + 1).padStart(4)}  ${String(config.holeNumbers[position]).padStart(4)}  ` +
                `${String(table.pars[position]).padStart(3)}  ${String(table.indexes[position]).padStart(3)}  ` +
                `${String(strokes).padStart(7)}  ${String(points[position]).padStart(6)}${alt}${differs}`,
        );
    });

    const total = sum(points);
    if (otherPoints) {
        const differing = points.filter((value, index) => value !== otherPoints[index]).length;
        console.log(`\n  ${total} points on ${config.label}, ${sum(otherPoints)} if the card had landed on the other nine.`);
        console.log(
            differing > 0
                ? `  ${differing} of ${card.length} holes would score differently, so this card can tell the nines apart.`
                : `  WARNING: no hole would score differently, so points cannot tell these nines apart here.`,
        );
    } else {
        console.log(`\n  ${total} points on ${config.label}.`);
    }
}
