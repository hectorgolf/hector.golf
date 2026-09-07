/**
 * Reading rounds that already exist: the `list-rounds` and `show-round` commands.
 *
 * `list-rounds` lists what the account has, shows the card of whichever round is
 * picked, and offers whatever can still be done to it. `show-round` prints one round
 * as the server stores it, which is the tool to reach for when a card looks wrong.
 */

import { writeFileSync } from "node:fs";

import { MScorecardClient, MScorecardTransport } from "../index.ts";
import type { RoundSummary } from "../types.ts";
import { offerRoundActions } from "./actions.ts";
import { configurationOf, printCard } from "./card.ts";
import type { Prompter } from "./prompts.ts";

export async function listRoundsCommand(client: MScorecardClient, prompt: Prompter): Promise<void> {
    const rounds = await client.listRounds();
    if (rounds.length === 0) {
        console.log("\nThis account has no rounds.");
        return;
    }

    const chosen = await prompt.choose("Which round", rounds, describeSummary);
    const round = await client.openRound(chosen.roundID);

    console.log(`\n=== round ${chosen.roundID} — ${chosen.courseName}, ${chosen.displayDate} ===`);
    console.log(`  npx tsx src/code/mscorecard/cli/main.ts show-round ${chosen.roundID}`);

    // The nines come from the round itself, so the card is laid out the way the
    // server has it rather than the way we might assume.
    const config = configurationOf(round.descriptor.nine1, round.descriptor.nine2, round.course);
    printCard(round.course, config, round);

    console.log(`\n  ${state(round.isFinished, chosen)}`);

    await offerRoundActions(client, prompt, round);
}

/**
 * One line per round, enough to tell them apart and spot a card that never landed.
 *
 * The round ID leads, because it is the one part worth copying: it is what
 * `show-round` takes, and what the app and the API call the round everywhere else.
 */
export function describeSummary(round: RoundSummary): string {
    const strokes = round.totalStrokes === undefined ? "no scores" : `${round.totalStrokes} strokes`;
    const points = round.stableford === undefined ? "" : `, ${round.stableford} pts`;
    const flags = [
        round.countsTowardsHandicap ? "handicap round" : "practice",
        round.submitted ? "submitted" : undefined,
    ]
        .filter(Boolean)
        .join(", ");
    return (
        `${round.roundID.padEnd(14)} ${round.displayDate.padEnd(12)} ` +
        `${round.courseName.padEnd(34)} ${strokes}${points}  (${flags})`
    );
}

function state(finished: boolean, round: RoundSummary): string {
    return [
        finished ? "Finished" : "Not finished",
        round.countsTowardsHandicap ? "counts towards handicap" : "practice round",
        round.submitted ? "submitted" : "not submitted",
    ].join(", ");
}

/**
 * Prints a round exactly as the server stores it, field by field.
 *
 * Deliberately not routed through the SDK's own interpretation: what a client
 * believes and what the server holds can differ in ways a tidy summary hides.
 */
export async function showRoundCommand(
    client: MScorecardClient,
    roundID: string,
    jsonPath?: string,
    /** Omitted when there is no terminal, which leaves this command pipe-friendly. */
    prompt?: Prompter,
): Promise<void> {
    const transport = new MScorecardTransport();
    transport.adopt(client.session);
    const body = await transport.get(`rounds/${roundID}`, { uid: "", ver: "9110" });

    if (jsonPath) {
        writeFileSync(jsonPath, JSON.stringify(body, null, 2));
        console.log(`Wrote the raw response to ${jsonPath}`);
    }

    const round = (body.round ?? {}) as Record<string, any>;
    const course = (round.course ?? {}) as Record<string, any>;

    console.log(`\n--- round ${roundID} ---`);
    for (const field of [
        "roundID",
        "courseID",
        "nine1",
        "nine2",
        "date",
        "finished",
        "hcpRoundSubmitted",
        "gameFormat",
        "numPlayers",
        "numGroups",
        "markerName",
        "competitionName",
        "noEdit",
    ]) {
        if (round[field] !== undefined) console.log(`  ${field.padEnd(18)} ${JSON.stringify(round[field])}`);
    }

    console.log("\n--- course as the round stores it ---");
    for (const field of ["courseID", "courseName", "numHoles", "numNines", "nine1", "nine2"]) {
        if (course[field] !== undefined) console.log(`  ${field.padEnd(18)} ${JSON.stringify(course[field])}`);
    }
    if (course.club?.name) console.log(`  ${"club".padEnd(18)} ${JSON.stringify(course.club.name)}`);

    for (const score of (round.scores ?? []) as Record<string, any>[]) {
        const name = score.player?.name ?? score.name ?? "?";
        console.log(`\n--- ${name} (sid ${score.ID ?? score.sid}) ---`);
        for (const field of ["playerID", "courseHcp", "hcpBefore", "hcpAllowance", "teeID", "extTeeID", "hcpRound"]) {
            if (score[field] !== undefined) console.log(`  ${field.padEnd(18)} ${JSON.stringify(score[field])}`);
        }
        const strokes = (score.strokes ?? score.st ?? []) as number[];
        console.log(`  ${"strokes".padEnd(18)} ${JSON.stringify(strokes)}`);
        // The array is indexed by course hole, so these are hole numbers, and a
        // back-nine round filling 1-9 is the signature of a client that sent
        // positions instead.
        const holes = strokes.flatMap((value, index) => (value > 0 ? [index + 1] : []));
        console.log(
            `  ${"scored holes".padEnd(18)} ${holes.length === 0 ? "none" : `${holes[0]}-${holes[holes.length - 1]}`}`,
        );
    }

    if (!prompt) return;

    // Re-read through the SDK for the action menu: the dump above is deliberately
    // uninterpreted, and the menu needs a round object to act on.
    const opened = await client.openRound(roundID);
    await offerRoundActions(client, prompt, opened);
}
