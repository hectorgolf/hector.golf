/**
 * A command line tool for mscorecard.com.
 *
 *     npx tsx src/code/mscorecard/cli/main.ts help
 *
 * A command has to be asked for. Run with none and it prints its usage and stops,
 * rather than picking one that would write to a real account. `printUsage()` in
 * `options.ts` is the one description of what each command does.
 *
 * Requires MSCORECARD_EMAIL and MSCORECARD_PASSWORD in the environment.
 */

import { MScorecardClient } from "../index.ts";
import { parse, printUsage } from "./options.ts";
import { createPrompter, isInteractive, required, type Prompter } from "./prompts.ts";
import { editRoundCommand } from "./edit.ts";
import { listRoundsCommand, showRoundCommand } from "./rounds.ts";
import { createRoundCommand, type CreateCommand } from "./run.ts";
import { chooseRound } from "./select.ts";
import { runSelfTest } from "./selftest.ts";
import { outcomeFor } from "./util.ts";

const invocation = parse();

// Opened lazily, and closed only if it was opened: `help`, a bad command line and
// `show-round` all work with no terminal at all, which matters for piping and CI.
let prompter: Prompter | undefined;
const prompt = (): Prompter => (prompter ??= createPrompter());

let failure: unknown;
try {
    await main();
} catch (error) {
    failure = error;
} finally {
    // Closed before anything is reported, so the terminal is back to normal and the
    // message is the last thing on screen.
    prompter?.close();
}
if (failure !== undefined) report(failure);

/** Turns a failure into an exit. See `outcomeFor` for what counts as ordinary. */
function report(error: unknown): void {
    const outcome = outcomeFor(error);
    if (!outcome) throw error;
    (outcome.toStderr ? console.error : console.log)(outcome.text);
    process.exit(outcome.code);
}

async function main(): Promise<void> {
    const { command, args, verbose, json } = invocation;

    if (command === "show-round") {
        const roundID = args[0];
        if (!roundID) {
            console.error("show-round needs a round ID.\n");
            printUsage();
            process.exitCode = 2;
            return;
        }
        const client = await login();
        // Pipe-friendly: with no terminal it prints and stops, rather than failing
        // on a menu nobody could answer.
        await showRoundCommand(client, roundID, json, isInteractive() ? prompt() : undefined);
        return;
    }

    // Open stdin before logging in: a command that cannot ask questions should say
    // so without first making a network round trip on an account.
    const asking = prompt();
    const client = await login();

    switch (command) {
        case "list-rounds":
            return listRoundsCommand(client, asking);

        // The round ID is optional here: without one, the command asks.
        case "edit-round":
            return editRoundCommand(client, asking, args[0]);

        case "self-test": {
            const setup = await chooseRound(client, asking);
            return runSelfTest(client, asking, { ...setup, verbose });
        }

        default:
            return createRoundCommand(client, asking, command satisfies CreateCommand);
    }
}

async function login(): Promise<MScorecardClient> {
    const client = new MScorecardClient();
    await client.login(required("MSCORECARD_EMAIL"), required("MSCORECARD_PASSWORD"));
    return client;
}
