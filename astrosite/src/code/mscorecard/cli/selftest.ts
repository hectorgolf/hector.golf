/**
 * The `--test` mode: round-trip a scratch round without submitting anything.
 *
 * The round is created with `hcpRound: 0`, `submitForHandicap()` is never called,
 * and the round is deleted again in a `finally` so a failed check leaves no litter.
 * The handicap flag is switched on and back off along the way, which touches nothing
 * outside mScorecard: only the submit sends anything to the golf association.
 */

import { MScorecardClient, roundReferenceFor, stablefordPoints } from "../index.ts";
import type { Course, CourseSummary, RosterPlayer, Tee } from "../types.ts";
import { playingHandicapFor } from "../scoring.ts";
import { HOLES_PER_NINE, holeTableOf, type NineConfiguration } from "./nines.ts";
import { showStoredRound, reportScorecard } from "./report.ts";
import type { Prompter } from "./prompts.ts";
import { sameNumbers } from "./util.ts";

export type SelfTestSetup = {
    course: Course;
    summary: CourseSummary;
    config: NineConfiguration;
    tee: Tee;
    player: RosterPlayer;
    courseHcp: number;
    verbose: boolean;
};

type Check = { label: string; ok: boolean; detail?: string };

/**
 * Round-trips a scratch round against the live API without submitting anything.
 *
 * The round is created with `hcpRound: 0`, so it counts towards nobody's handicap,
 * `submitForHandicap()` is never called, and the round is deleted again in a
 * `finally` so a failed check does not leave litter behind. The handicap flag is
 * switched on and back off along the way, which touches nothing outside mScorecard:
 * only the submit sends anything to the golf association, and this never submits.
 *
 * What it is actually checking is that the card the server stores is the card we
 * meant to write. Two real bugs hid there: a nine-hole round was submitted with a
 * nine-entry `strokes` array where the API's invariant is eighteen slots padded with
 * `-1`, and `openRound()` read the wrong field names entirely, because creating a
 * round and reading one back do not agree on what a score row is called.
 */
export async function runSelfTest(client: MScorecardClient, prompt: Prompter, setup: SelfTestSetup): Promise<void> {
    const { course, summary, config, tee, player, courseHcp, verbose } = setup;
    const expected = selfTestCard(config);

    console.log("\n--- SELF TEST ---");
    console.log(`  Club:    ${course.club.name} (${summary.courseID})`);
    console.log(`  Nines:   ${config.label} — nine1: ${config.nine1}, nine2: ${config.nine2}`);
    console.log(`  Tee:     ${tee.name}`);
    console.log(`  Player:  ${player.name}`);
    console.log(`  Card:    ${expected.join(", ")}`);
    console.log("\nA scratch round will be created, scored, read back and deleted.");
    console.log("Nothing is submitted for handicap calculation, in this mode or any part of it.");
    if (!(await prompt.confirm("Run the self test"))) {
        console.log("Cancelled, nothing was sent.");
        return;
    }

    const checks: Check[] = [];
    const check = (label: string, ok: boolean, detail?: string) => checks.push({ label, ok, detail });

    const round = await client.createRound({
        courseID: summary.courseID,
        nine1: config.nine1,
        nine2: config.nine2,
        noNotifications: true,
        players: [
            {
                ...roundReferenceFor(player, client.userID),
                teeID: tee.teeID,
                extTeeID: tee.extTeeID,
                courseHcp,
                hcpBefore: player.hcp,
                gender: player.gender,
                hcpRound: 0, // the whole point: this round counts towards nothing
            },
        ],
    });
    console.log(`\nCreated scratch round ${round.roundID}`);

    try {
        const slot = round.players[0];
        check("round creation returns a sid for the player", Boolean(slot?.sid), `sid ${slot?.sid}`);
        check("round has the expected hole count", round.numHoles === config.holes, `${round.numHoles} holes`);

        // Deliberately scrambled and split across two writes: order must not matter,
        // and the ts chain has to survive more than one PATCH.
        const entries = expected.map((strokes, index) => ({
            player: player.name,
            // Course hole numbers, which for a back nine means 10-18.
            hole: round.holes[index]!,
            strokes,
        }));
        const odd = entries.filter((_, index) => index % 2 === 0).reverse();
        const even = entries.filter((_, index) => index % 2 === 1);
        const tsBefore = round.ts;
        await round.score(odd);
        const tsMiddle = round.ts;
        await round.score(even);
        check("the ts token advances on every write", tsBefore !== tsMiddle && tsMiddle !== round.ts);

        // The moment of truth: what did the server actually keep?
        const stored = await client.openRound(round.roundID);
        const storedSlot = stored.players[0];

        check(
            "the round reads back with the same sid",
            storedSlot?.sid === slot?.sid,
            `wrote ${slot?.sid}, read ${storedSlot?.sid}`,
        );
        check(
            "the player's name survives the round trip",
            storedSlot?.name === player.name,
            `read "${storedSlot?.name}"`,
        );
        check(
            "the course handicap is stored as sent",
            storedSlot?.courseHcp === courseHcp,
            `sent ${courseHcp}, read ${storedSlot?.courseHcp}`,
        );
        check(
            "the nine configuration round-trips",
            stored.descriptor.nine1 === config.nine1 && stored.descriptor.nine2 === config.nine2,
            `read nine1 ${stored.descriptor.nine1}, nine2 ${stored.descriptor.nine2}`,
        );

        const card = storedSlot ? stored.card(storedSlot.sid) : [];
        check("the stored card is eighteen slots long", card.length === 18, `${card.length} slots`);
        check(
            `holes 1-${config.holes} came back in the right order`,
            sameNumbers(card.slice(0, config.holes), expected),
            `expected ${expected.join(",")}\n     got      ${card.slice(0, config.holes).join(",")}`,
        );
        if (config.holes < 18) {
            check(
                "the unplayed holes are -1, not zeroes or blanks",
                card.slice(config.holes).every((value) => value === -1),
                `tail ${card.slice(config.holes).join(",")}`,
            );
        }

        // The sharpest check of all. Reading a round back embeds the course as the
        // *server* has it, pars and stroke indexes included — so we can ask whether
        // the server thinks these strokes were played on the holes we meant, rather
        // than just comparing our own numbers to themselves.
        const theirs = holeTableOf(stored.course, config);
        const ours = holeTableOf(course, config);
        if (!theirs || !ours) {
            check("the round carries a par table to check against", false, "no parIndex for these nines");
        } else {
            check(
                "the server's pars are the pars of the nines we chose",
                sameNumbers(theirs.pars, ours.pars),
                `expected ${ours.pars.join(",")}\n     got      ${theirs.pars.join(",")}`,
            );
            check(
                "the server's stroke indexes match too",
                sameNumbers(theirs.indexes, ours.indexes),
                `expected ${ours.indexes.join(",")}\n     got      ${theirs.indexes.join(",")}`,
            );

            // courseHcp is an eighteen-hole allowance even on a nine-hole card.
            const playing = playingHandicapFor(courseHcp, config.holes);
            const points = stablefordPoints(card.slice(0, config.holes), theirs.pars, theirs.indexes, playing);
            const predicted = stablefordPoints(expected, ours.pars, ours.indexes, playing);
            check(
                "every hole scores the Stableford points it should",
                sameNumbers(points, predicted),
                `expected ${predicted.join(",")}\n     got      ${points.join(",")}`,
            );
            reportScorecard(course, config, card.slice(0, config.holes), theirs, points, playing);
        }

        // The handicap flag is the one request shape in this SDK that no capture
        // shows the app making, so it is worth exercising — here, where it can be
        // turned straight back off again. Nothing in this routine submits anything,
        // and the flag alone does not: only the submit PUT reaches the federation.
        check("the round starts as a practice round", !round.countsTowardsHandicap(player.name));

        await round.setCountsTowardsHandicap(player.name, true);
        const flagged = await client.openRound(round.roundID);
        check(
            "flagging it as a handicap round sticks",
            flagged.players[0]?.hcpRound === 1,
            `read hcpRound ${flagged.players[0]?.hcpRound}`,
        );

        await round.setCountsTowardsHandicap(player.name, false);
        const unflagged = await client.openRound(round.roundID);
        check(
            "and it can be turned back into a practice round",
            unflagged.players[0]?.hcpRound === 0,
            `read hcpRound ${unflagged.players[0]?.hcpRound}`,
        );

        // The same side-by-side view the other modes print, while the round still
        // exists — the checks above say pass or fail, this says what it looks like.
        await showStoredRound(client, round.roundID, {
            heading: "As stored, before deleting",
            course,
            config,
            intended: expected,
            courseHcp,
        });
    } finally {
        // Always clean up, including after a failed check or a thrown error.
        await round.delete();
        console.log(`Deleted scratch round ${round.roundID}`);
    }

    let goneDetail = "still readable";
    let gone = false;
    try {
        await client.openRound(round.roundID);
    } catch (error) {
        gone = true;
        goneDetail = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    }
    check("the deleted round is gone", gone, goneDetail);

    report(checks, verbose);
}

/**
 * A card whose every value tells you where it belongs.
 *
 * Each half is a different rotation of 2..10, so a card that lands shifted, fully
 * reversed, or with its halves swapped cannot match by luck. (An ascending half
 * followed by its own reverse would be a palindrome and would survive a reversal.)
 * Every value stays inside the range of a plausible golf score.
 */
function selfTestCard(config: NineConfiguration): number[] {
    return Array.from({ length: config.holes }, (_, index) => {
        const rotation = index < HOLES_PER_NINE ? 0 : 4;
        return 2 + ((index + rotation) % HOLES_PER_NINE);
    });
}

function report(checks: readonly Check[], verbose: boolean): void {
    const failed = checks.filter((c) => !c.ok);
    console.log("\n--- RESULTS ---");
    for (const { label, ok, detail } of checks) {
        console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
        if (detail && (!ok || verbose)) console.log(`        ${detail}`);
    }
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
}
