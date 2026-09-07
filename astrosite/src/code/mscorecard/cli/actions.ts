/**
 * What can still be done to a round, offered wherever a round is on screen.
 *
 * Shared by `list-rounds`, `show-round` and `edit-round` so the same round offers
 * the same choices however you arrived at it. Everything is decided from the round
 * itself rather than from a list entry, because two of those three commands never
 * see a list entry.
 */

import { MScorecardClient, MScorecardRound, roundReferenceFor } from "../index.ts";
import type { PlayerSearchHit, RosterPlayer } from "../types.ts";
import { courseHandicap } from "./handicap.ts";
import type { Prompter } from "./prompts.ts";
import { formatWhen, parseRoundDate, parseWhen } from "./when.ts";

/** How a round is scored. The strokes are the same either way. */
const GAME_FORMATS = ["Stroke Play", "Stroke Play NET", "Stableford"] as const;

export type RoundAction = "finish" | "submit" | "reschedule" | "set-format" | "add-player" | "remove-player" | "delete";

/**
 * The actions a round is still open to.
 *
 * A submitted round is done with: the federation has it, and it can be neither
 * deleted nor changed. Removing a player is offered only while there is someone left
 * afterwards, since emptying a round is a deletion by another name.
 */
export function availableActions(round: MScorecardRound): RoundAction[] {
    if (round.isSubmitted || round.isDeleted) return [];
    const actions: RoundAction[] = [];
    if (!round.isFinished) actions.push("finish");
    actions.push("submit");
    actions.push("reschedule");
    actions.push("set-format");
    if (!round.isFinished) actions.push("add-player");
    if (round.players.length > 1) actions.push("remove-player");
    actions.push("delete");
    return actions;
}

function describe(action: RoundAction | "nothing"): string {
    return {
        finish: "Mark the round finished",
        submit: "Submit it as a handicap round (cannot be undone)",
        reschedule: "Change when the round was played",
        "set-format": "Change how the round is scored",
        "add-player": "Add a player to the round",
        "remove-player": "Remove a player from the round",
        delete: "Delete the round (cannot be undone)",
        nothing: "Leave it as it is",
    }[action];
}

/**
 * Offers what is possible, and keeps offering until there is nothing left to do or
 * the user says so.
 *
 * Removing a player or finishing a round changes what is possible next, so the menu
 * is rebuilt each time round rather than shown once.
 */
export async function offerRoundActions(
    client: MScorecardClient,
    prompt: Prompter,
    round: MScorecardRound,
): Promise<void> {
    for (;;) {
        const actions = availableActions(round);
        if (actions.length === 0) {
            console.log("\n  Nothing further can be done to this round from here.");
            return;
        }

        const action = await prompt.choose("What now", [...actions, "nothing" as const], describe);
        if (action === "nothing") {
            return;
        }

        if (action === "add-player") {
            // Adding re-reads the round, so the object the menu works on is replaced.
            const added = await addPlayer(client, prompt, round);
            if (added) round = added;
            continue;
        }
        if (await perform(client, prompt, round, action)) {
            return;
        }
    }
}

/**
 * Puts another player on the card.
 *
 * Anyone can be picked from the roster. Someone who is not on it yet is searched for
 * by name and sent a friend request first, because a round can only reference a
 * player the account already knows about.
 *
 * @returns The updated round if a player was added, or `undefined` if the
 *          operation was cancelled.
 */
async function addPlayer(
    client: MScorecardClient,
    prompt: Prompter,
    round: MScorecardRound,
): Promise<MScorecardRound | undefined> {
    const already = new Set(round.players.map((slot) => slot.playerID));
    const roster = (await client.listRoster()).filter((player) => !already.has(player.playerID));

    const source = await prompt.choose(
        "Who",
        ["roster", "search", "cancel"] as const,
        (choice) =>
            ({
                roster: `Someone already in the player list (${roster.length})`,
                search: "Search mScorecard for someone new",
                cancel: "Cancel",
            })[choice],
    );
    if (source === "cancel") return undefined;

    let player = source === "roster" ? await pickFromRoster(prompt, roster) : await findAndAdd(client, prompt, already);
    if (!player) return undefined;

    // The tee decides the course handicap, and a 54 playing off the reds is not
    // the same number as off the whites, so it is worth asking rather than copying.
    const model = round.players[0];
    const course = round.course;
    if (!model || !course) {
        console.log("\nThis round did not come with its course, so a tee cannot be chosen here.");
        return undefined;
    }

    const tee = await prompt.choose(
        "Which tee",
        course.tees,
        (t) => `${t.name.padEnd(14)}${t.teeID === model.teeID ? " (same as the others)" : ""}`,
    );
    const courseHcp = courseHandicap(player, tee, course);

    console.log(`\nAdding ${player.name} off the ${tee.name} tees, playing to ${courseHcp}.`);
    if (!(await prompt.confirm(`Add ${player.name}`))) {
        console.log("Cancelled, nothing was sent.");
        return undefined;
    }

    const added = await client.addPlayerToRound(round, {
        ...roundReferenceFor(player, client.userID),
        teeID: tee.teeID,
        extTeeID: tee.extTeeID,
        courseHcp,
        hcpBefore: player.hcp,
        gender: player.gender,
    });
    console.log(`Added ${added.name} as player ${added.playerNum} (sid ${added.sid}).`);
    return round;
}

async function pickFromRoster(prompt: Prompter, roster: RosterPlayer[]): Promise<RosterPlayer | undefined> {
    if (roster.length === 0) {
        console.log("\nEveryone in the player list is already on this card.");
        return undefined;
    }
    return prompt.choose("Which player", roster, (p) => `${p.name.padEnd(20)} HI ${p.hcp}`);
}

/**
 * Finds someone on mScorecard and adds them to the player list.
 *
 * A friend request has to go out first: the roster entry it creates is what a round
 * can point at. The request does not need accepting for that — a pending friend goes
 * into a round under our own entry.
 */
async function findAndAdd(
    client: MScorecardClient,
    prompt: Prompter,
    already: ReadonlySet<string>,
): Promise<RosterPlayer | undefined> {
    let hits: PlayerSearchHit[] = [];
    let search = "";
    while (hits.length === 0) {
        search = await prompt.ask("\nSearch for a name", search);
        hits = await client.searchPlayers(search);
        if (hits.length === 0) console.log(`Nobody called "${search}". Try again.`);
    }

    const hit = await prompt.choose(
        "Which one",
        hits,
        (h) => `${h.name.padEnd(22)} HI ${String(h.hcp).padEnd(6)} ${h.club || h.country}  (user ${h.userID})`,
    );

    if (!hit.playerID) {
        console.log(`\n${hit.name} is not in your player list yet, so a friend request goes out first.`);
        if (!(await prompt.confirm(`Send ${hit.name} a friend request`))) return undefined;
        await client.addFriend(hit.userID);
    }

    const roster = await client.listRoster();
    const added = roster.find((player) => player.friendUserID === hit.userID && !already.has(player.playerID));
    if (!added) {
        console.log(`\n${hit.name} did not appear in the player list. Try again in a moment.`);
        return undefined;
    }
    return added;
}

/** Carries out one action. Returns true when the round's life is over. */
async function perform(
    _: MScorecardClient,
    prompt: Prompter,
    round: MScorecardRound,
    action: RoundAction,
): Promise<boolean> {
    if (action === "finish") {
        await round.finish();
        console.log(`\nMarked round ${round.roundID} finished.`);
        return false;
    }

    if (action === "reschedule") {
        const current = parseRoundDate(round.descriptor.date);
        console.log(`\nThe round is recorded as played on ${current ? formatWhen(current) : round.descriptor.date}.`);
        const when = await askWhen(prompt, current ?? new Date());
        if (!when) return false;
        await round.setDate(when);
        console.log(`Moved round ${round.roundID} to ${formatWhen(when)}.`);
        return false;
    }

    if (action === "set-format") {
        const format = await prompt.choose(
            "How should it be scored",
            [0, 1, 2] as const,
            (value) => `${GAME_FORMATS[value]}${value === round.descriptor.gameFormat ? " (current)" : ""}`,
        );
        await round.setGameFormat(format);
        console.log(`\nRound ${round.roundID} is now scored as ${GAME_FORMATS[format]}.`);
        return false;
    }

    if (action === "remove-player") {
        const going = await prompt.choose(
            "Which player",
            [...round.players],
            (p) => `${p.name} (course handicap ${p.courseHcp})`,
        );
        console.log(`\nRemoving ${going.name} discards their scores and cannot be undone.`);
        if (!(await prompt.confirm(`Remove ${going.name}`, true))) {
            console.log("Cancelled, nothing was sent.");
            return false;
        }
        await round.removePlayer(going.sid);
        console.log(`Removed ${going.name}. ${round.players.length} player(s) left.`);
        return false;
    }

    if (action === "delete") {
        console.log(`\nDeleting round ${round.roundID} cannot be undone.`);
        if (!(await prompt.confirm("Delete this round", true))) {
            console.log("Cancelled, nothing was sent.");
            return false;
        }
        await round.delete();
        console.log(`Deleted round ${round.roundID}.`);
        return true;
    }

    // Submitting is the one action that leaves mScorecard, so a player has to be
    // switched on deliberately first and the confirmation demands the whole word.
    const player =
        round.players.length === 1
            ? round.players[0]!
            : await prompt.choose("Whose round is being submitted", [...round.players], (p) => p.name);
    console.log("\nSubmitting forwards the round to the Finnish Golf Association and cannot be undone.");
    if (!(await prompt.confirm("Submit this round", true))) {
        console.log("Cancelled, nothing was sent.");
        return false;
    }
    await round.setCountsTowardsHandicap(player.sid, true);
    console.log(`Marked ${player.name}'s round as counting towards their handicap.`);
    await round.submitForHandicap();
    console.log(`Round ${round.roundID} submitted for handicap calculation.`);
    return true;
}

/** Asks when the round was played, re-asking until it reads as a date. */
async function askWhen(prompt: Prompter, current: Date): Promise<Date | undefined> {
    for (;;) {
        const answer = await prompt.ask(
            'When was it played ("YYYY-MM-DD HH:MM", or just "HH:MM")',
            formatWhen(current),
        );
        const when = parseWhen(answer, current);
        if (when) return when;
        console.log(`"${answer}" is not a date and time I can read.`);
    }
}
