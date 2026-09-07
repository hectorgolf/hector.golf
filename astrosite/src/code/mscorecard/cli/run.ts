/**
 * Creating a round: the `create-round`, `finish-round` and `submit-round` commands.
 *
 * The three share every step but the last, so they share this file. Only
 * `submit-round` reaches the golf association, and only it cannot be undone.
 */

import { MScorecardClient, roundReferenceFor } from "../index.ts";
import type { Command } from "./options.ts";
import type { Prompter } from "./prompts.ts";
import { showStoredRound } from "./report.ts";
import { askForStrokes } from "./scorecard.ts";
import { chooseRound, DEFAULT_MARKER_NAME } from "./select.ts";
import { sum } from "./util.ts";

/** How a round is scored. New rounds are Stableford unless changed afterwards. */
const GAME_FORMATS = ["Stroke Play", "Stroke Play NET", "Stableford"] as const;
const DEFAULT_GAME_FORMAT = 2;

/** The commands this module handles. */
export type CreateCommand = Extract<Command, "create-round" | "finish-round" | "submit-round">;

const PLAN: Record<CreateCommand, string> = {
    "create-round": "Create this round and score it, leaving it unfinished",
    "finish-round": "Create this round, score it and mark it finished",
    "submit-round": "Create this round, finish it and submit it for handicap calculation",
};

export async function createRoundCommand(
    client: MScorecardClient,
    prompt: Prompter,
    command: CreateCommand,
): Promise<void> {
    const submitting = command === "submit-round";
    const finishing = submitting || command === "finish-round";

    const { facility, summary, course, config, tee, player, courseHcp } = await chooseRound(client, prompt);
    const markerName = await prompt.ask("\nWho marked the card", DEFAULT_MARKER_NAME);
    const strokes = await askForStrokes(prompt, config);

    console.log(`\n--- ${PLAN[command]} ---`);
    console.log(`  Club:     ${facility.clubName}`);
    console.log(`  Course:   ${course.courseName || summary.courseName} (${summary.courseID})`);
    console.log(`  Nines:    ${config.label} (nine1 ${config.nine1}, nine2 ${config.nine2})`);
    console.log(`  Tee:      ${tee.name}`);
    console.log(`  Player:   ${player.name} (course handicap ${courseHcp})`);
    console.log(`  Marker:   ${markerName}`);
    console.log(`  Scoring:  ${GAME_FORMATS[DEFAULT_GAME_FORMAT]} (change it later with list-rounds)`);
    console.log(`  Scores:   ${strokes.join(", ")} = ${sum(strokes)} strokes (par ${sum(config.pars)})`);

    if (submitting) {
        console.log("\nSubmitting forwards the round to the Finnish Golf Association and cannot be undone.");
    } else {
        // Rounds are practice rounds unless deliberately switched, so an accidental
        // run cannot leave a handicap-scoring round behind.
        console.log("\nThis will be a practice round, counting towards no handicap.");
    }
    if (!(await prompt.confirm(submitting ? "Submit this round" : "Go ahead", submitting))) {
        console.log("Cancelled, nothing was sent.");
        return;
    }

    const round = await client.createRound({
        courseID: course.courseID,
        nine1: config.nine1,
        nine2: config.nine2,
        markerName,
        noNotifications: true,
        players: [
            {
                // An accepted friend goes into a round under their own player
                // record, not our copy of them.
                ...roundReferenceFor(player, client.userID),
                teeID: tee.teeID,
                extTeeID: tee.extTeeID,
                courseHcp,
                hcpBefore: player.hcp,
                gender: player.gender,
                // Left as a practice round. submit-round flips it just before
                // submitting, so nothing here can put a round into a handicap
                // record by accident.
            },
        ],
    });

    console.log(`\nCreated round ${round.roundID} (${round.numHoles} holes)`);
    // The sid is a scorecard row ID the server minted for this round only. We never
    // pass it around by hand — the round resolves players by name or playerID.
    console.log(`  ${round.players[0]!.name} -> sid ${round.players[0]!.sid}`);

    // Scores go out keyed by course hole, so a back-nine round writes h: 10-18.
    // `scorePlayer` takes the card in play order and does that mapping.
    await round.scorePlayer(player.name, strokes);
    console.log(`Scored ${strokes.length} holes: ${strokes.join(", ")}`);

    if (finishing) {
        await round.finish();
        console.log(`Marked round ${round.roundID} finished.`);
    }

    await showStoredRound(client, round.roundID, {
        heading: submitting ? "As stored, before submitting" : "As stored",
        course,
        config,
        intended: strokes,
        courseHcp,
    });

    if (!submitting) {
        console.log(
            finishing
                ? `\nRound ${round.roundID} is finished but not submitted.`
                : `\nRound ${round.roundID} is open and unfinished. Finish or delete it with list-rounds.`,
        );
        return;
    }

    // Every round is created as a practice round, so this is the moment it becomes
    // a handicap round — deliberately, and only under submit-round.
    await round.setCountsTowardsHandicap(player.name, true);
    console.log(`\nMarked ${player.name}'s round as counting towards their handicap.`);

    /**
     * `submitForHandicap()` marks the round finished *and* submits it, so the
     * `finish()` above is redundant — harmless, since both are no-ops the second
     * time, and it keeps the finished state visible before the irreversible step.
     * It refuses outright if no player has been switched on.
     */
    await round.submitForHandicap(markerName);
    console.log(`\nRound ${round.roundID} submitted for handicap calculation.`);

    await showStoredRound(client, round.roundID, {
        heading: "As stored, after submitting",
        course,
        config,
        intended: strokes,
        courseHcp,
    });
}
