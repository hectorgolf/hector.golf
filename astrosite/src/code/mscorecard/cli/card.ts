/**
 * Laying a stored round out as a scorecard.
 *
 * Shared by the commands that display a round, so a card looks the same whether
 * it was just written, browsed to, or is about to be edited.
 */

import { playingHandicapFor, stablefordPoints } from "../index.ts";
import type { Course } from "../types.ts";
import { holeTableOf, HOLES_PER_NINE, type NineConfiguration } from "./nines.ts";
import { sum } from "./util.ts";

/** Rebuilds a configuration from a round's own nines, for laying the card out. */
export function configurationOf(nine1: number, nine2: number, course: Course | undefined): NineConfiguration {
    const holesOf = (nine: number) =>
        Array.from({ length: HOLES_PER_NINE }, (_, index) => (nine - 1) * HOLES_PER_NINE + index + 1);
    const holeNumbers = nine2 ? [...holesOf(nine1), ...holesOf(nine2)] : holesOf(nine1);
    const config = {
        nine1,
        nine2,
        label: nine2 ? `nines ${nine1} and ${nine2}` : `nine ${nine1}`,
        holes: holeNumbers.length,
        holeNumbers,
        pars: [],
        ratingsKey: `ratings_${nine1}_${nine2 || nine1}`,
    } as unknown as NineConfiguration;
    config.pars = holeTableOf(course, config)?.pars ?? [];
    return config;
}

export function printCard(
    course: Course | undefined,
    config: NineConfiguration,
    round: { players: readonly { sid: string; name: string; courseHcp: number }[]; card(sid: string): number[] },
): void {
    const table = holeTableOf(course, config);
    for (const player of round.players) {
        const card = round.card(player.sid).slice(0, config.holes);
        const playing = playingHandicapFor(player.courseHcp, config.holes);
        console.log(`\n--- ${player.name}, course handicap ${player.courseHcp} (${playing} strokes here) ---`);
        if (!table) {
            console.log(`  ${card.join(", ")}`);
            continue;
        }
        const points = stablefordPoints(card, table.pars, table.indexes, playing);
        console.log("  hole  par  idx  strokes  points");
        card.forEach((strokes, position) => {
            console.log(
                `  ${String(config.holeNumbers[position]).padStart(4)}  ${String(table.pars[position]).padStart(3)}  ` +
                    `${String(table.indexes[position]).padStart(3)}  ` +
                    `${String(strokes === -1 ? "-" : strokes).padStart(7)}  ${String(points[position]).padStart(6)}`,
            );
        });
        const played = card.filter((value) => value > 0);
        console.log(
            `\n  ${played.length}/${config.holes} holes, ${sum(played)} strokes, ${sum(points)} Stableford points.`,
        );
    }
}
