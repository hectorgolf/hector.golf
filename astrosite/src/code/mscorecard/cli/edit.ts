/**
 * The `edit-round` command: change the scores on a round that is still open.
 *
 * Edits are collected locally and written in one go once the changes have been shown
 * and confirmed, rather than each keystroke going straight to the server. A mistake
 * part-way through an edit is then just a cancelled command.
 */

import { MScorecardClient, MScorecardRound } from "../index.ts";
import { offerRoundActions } from "./actions.ts";
import { configurationOf, printCard } from "./card.ts";
import type { NineConfiguration } from "./nines.ts";
import type { Prompter } from "./prompts.ts";
import { showStoredRound } from "./report.ts";
import { describeSummary } from "./rounds.ts";

const NOT_ENTERED = -1;
/** What the user types to take a score back off a hole. */
const CLEAR = "-";

/**
 * Reads one entry off a card: a score, or `-` for a hole with nothing on it.
 *
 * A cleared hole is written as `st: -1`, which the API accepts and the app shows as
 * empty. `-1` is taken as input too, since that is what the API calls an empty hole
 * and is a reasonable thing to type. Returns undefined for anything else, which the
 * callers turn into a re-prompt.
 *
 * The inverse of `formatStrokes`, which matters because the prompts offer the
 * current card as their default: whatever is shown has to read back as itself.
 */
export function parseStrokes(token: string): number | undefined {
    const trimmed = token.trim();
    if (trimmed === CLEAR || trimmed === String(NOT_ENTERED)) return NOT_ENTERED;
    const value = Number(trimmed);
    return trimmed !== "" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** How a score is shown on a card, and offered back as a prompt's default. */
export function formatStrokes(strokes: number): string {
    return strokes === NOT_ENTERED ? CLEAR : `${strokes}`;
}

export async function editRoundCommand(client: MScorecardClient, prompt: Prompter, roundID?: string): Promise<void> {
    const round = roundID ? await client.openRound(roundID) : await pickAnEditableRound(client, prompt);
    if (!round) return;

    // Both states come from the round the server sent, not from anything this
    // client did, so a round finished or submitted elsewhere is caught here too.
    if (round.isSubmitted) {
        console.log(`\nRound ${round.roundID} has been submitted for handicap calculation and cannot be edited.`);
        return;
    }
    if (round.isFinished) {
        console.log(`\nRound ${round.roundID} is finished. Only an unfinished round can be edited.`);
        return;
    }

    const config = configurationOf(round.descriptor.nine1, round.descriptor.nine2, round.course);
    const player =
        round.players.length === 1
            ? round.players[0]!
            : await prompt.choose("Whose card", [...round.players], (p) => p.name);

    const stored = round.card(player.sid).slice(0, config.holes);
    console.log(`\n=== round ${round.roundID} — ${player.name} ===`);
    printCard(round.course, config, round);

    const draft = [...stored];
    if (!(await edit(prompt, config, draft))) {
        console.log("Cancelled, nothing was sent.");
        return;
    }

    const changes = draft.flatMap((strokes, position) =>
        strokes === stored[position] ? [] : [{ position, from: stored[position]!, to: strokes }],
    );
    if (changes.length === 0) {
        console.log("\nNothing changed.");
        return offerRoundActions(client, prompt, round);
    }

    console.log("\n--- Changes ---");
    for (const { position, from, to } of changes) {
        console.log(`  hole ${String(config.holeNumbers[position]).padStart(2)}: ${formatStrokes(from)} -> ${formatStrokes(to)}`);
    }
    if (!(await prompt.confirm(`Write ${changes.length === 1 ? "this change" : "these changes"}`))) {
        console.log("Cancelled, nothing was sent.");
        return offerRoundActions(client, prompt, round);
    }

    // Only the holes that actually changed, in one request. `score()` maps each
    // position to its course hole number on the way out.
    await round.score(
        changes.map(({ position, to }) => ({
            player: player.sid,
            hole: config.holeNumbers[position]!,
            strokes: to,
        })),
    );
    console.log(`\nWrote ${changes.length} change${changes.length === 1 ? "" : "s"}.`);

    await showStoredRound(client, round.roundID, {
        heading: "As stored",
        course: round.course!,
        config,
        intended: draft,
        courseHcp: player.courseHcp,
    });

    await offerRoundActions(client, prompt, round);
}

/**
 * Lists the rounds that could be edited and asks which one.
 *
 * The rounds list carries no "finished" flag, so this can only filter out the
 * submitted ones; whether the chosen round is finished is settled by reading it.
 */
async function pickAnEditableRound(client: MScorecardClient, prompt: Prompter): Promise<MScorecardRound | undefined> {
    const rounds = (await client.listRounds()).filter((round) => !round.submitted);
    if (rounds.length === 0) {
        console.log("\nThis account has no unsubmitted rounds to edit.");
        return undefined;
    }
    const chosen = await prompt.choose("Which round", rounds, describeSummary);
    return client.openRound(chosen.roundID);
}

/** Runs the edit loop. Returns false if the user backed out. */
async function edit(prompt: Prompter, config: NineConfiguration, draft: number[]): Promise<boolean> {
    for (;;) {
        console.log(`\n  ${config.holeNumbers.map((hole, i) => `${hole}:${formatStrokes(draft[i]!)}`).join("  ")}`);

        const choice = await prompt.choose("What now", ["hole", "all", "done", "cancel"] as const, (action) =>
            ({
                hole: "Change one hole",
                all: "Re-enter the whole card",
                done: "Done — review the changes",
                cancel: "Cancel, changing nothing",
            })[action],
        );

        if (choice === "cancel") return false;
        if (choice === "done") return true;

        if (choice === "all") {
            const entered = await readCard(prompt, config, draft);
            entered.forEach((strokes, index) => (draft[index] = strokes));
            continue;
        }

        const position = await prompt.choose(
            "Which hole",
            config.holeNumbers.map((_, index) => index),
            (index) => `hole ${config.holeNumbers[index]} (par ${config.pars[index]}), currently ${formatStrokes(draft[index]!)}`,
        );
        draft[position] = await readStrokes(prompt, config.holeNumbers[position]!, draft[position]!);
    }
}

/** Reads one hole's score, re-asking until it is a plausible one. */
async function readStrokes(prompt: Prompter, hole: number, current: number): Promise<number> {
    for (;;) {
        const answer = await prompt.ask(`Strokes on hole ${hole} ("${CLEAR}" to clear it)`, formatStrokes(current));
        const value = parseStrokes(answer);
        if (value !== undefined) return value;
        console.log(`"${answer}" is not a positive whole number, nor "${CLEAR}".`);
    }
}

/** Reads a whole card on one line, defaulting to what is there now. */
async function readCard(prompt: Prompter, config: NineConfiguration, current: readonly number[]): Promise<number[]> {
    const first = config.holeNumbers[0];
    const last = config.holeNumbers[config.holeNumbers.length - 1];
    for (;;) {
        const answer = await prompt.ask(
            `\nStrokes for holes ${first}-${last} ("${CLEAR}" for a hole not played)`,
            current.map(formatStrokes).join(", "),
        );
        const tokens = answer.split(/[\s,]+/).filter(Boolean);
        if (tokens.length !== config.holes) {
            console.log(`Expected ${config.holes} entries, got ${tokens.length}.`);
            continue;
        }
        const values = tokens.map(parseStrokes);
        const bad = values.findIndex((value) => value === undefined);
        if (bad !== -1) {
            console.log(`Hole ${config.holeNumbers[bad]} is not a positive whole number, nor "${CLEAR}".`);
            continue;
        }
        return values as number[];
    }
}
