/**
 * Command line parsing and the usage text.
 *
 * The usage text is the one description of what the commands do; other modules
 * point here rather than repeating it, because that duplicate drifted once already.
 */

/** What the run will actually do. See `printUsage()` for what each command means. */
export type Command =
    | "create-round"
    | "finish-round"
    | "submit-round"
    | "list-rounds"
    | "show-round"
    | "edit-round"
    | "self-test"
    | "help";

export const COMMANDS = [
    "create-round",
    "finish-round",
    "submit-round",
    "list-rounds",
    "show-round",
    "edit-round",
    "self-test",
    "help",
] as const;

export const OPTIONS = ["verbose", "json"] as const;

/** Everything the CLI reads off the command line. */
export type Invocation = {
    /** The command to run, with `help` already dealt with by `parse()`. */
    command: Exclude<Command, "help">;
    /** Positional arguments after the command, e.g. a round ID for `show-round`. */
    args: string[];
    /** Show the detail behind checks that passed, not only the failures. */
    verbose: boolean;
    /** For `show-round`: write the raw response to this file. */
    json?: string;
};

/**
 * Reads the command line, printing usage and exiting for `help`, for no command at
 * all, and for anything it cannot make sense of.
 *
 * Takes the arguments rather than reading `process.argv` so that it can be tested;
 * `readCommand` is separated for the same reason.
 */
export function parse(argv: readonly string[] = process.argv.slice(2)): Invocation {
    const command = readCommand(argv);
    if (command === "help") {
        printUsage();
        process.exit(0);
    }
    // The command word is not an argument to itself; everything else positional is.
    const words = positionals(argv);
    const at = words.indexOf(command);
    const args = at === -1 ? words : [...words.slice(0, at), ...words.slice(at + 1)];

    return { command, args, verbose: argv.includes("--verbose"), json: valueOf(argv, "--json") };
}

/** Options that swallow the argument after them. */
const OPTIONS_WITH_VALUES: readonly string[] = ["--json"];

/** The value following an option, as in `--json out.json`. */
function valueOf(argv: readonly string[], option: string): string | undefined {
    const index = argv.indexOf(option);
    return index === -1 ? undefined : argv[index + 1];
}

/**
 * The arguments that are neither options nor the values belonging to them.
 *
 * Worth doing by index rather than by value: comparing against "the argument after
 * `--json`" when there is no `--json` at all silently swallows the first word, which
 * is the command.
 */
function positionals(argv: readonly string[]): string[] {
    const consumed = new Set<number>();
    argv.forEach((arg, index) => {
        if (!arg.startsWith("-")) return;
        consumed.add(index);
        if (OPTIONS_WITH_VALUES.includes(arg)) consumed.add(index + 1);
    });
    return argv.filter((_, index) => !consumed.has(index));
}

/** Picks the command out of the arguments, or exits having said why it could not. */
export function readCommand(argv: readonly string[]): Command {
    const known: readonly string[] = OPTIONS.map((name) => `--${name}`);
    const unknownFlags = argv.filter((arg) => arg.startsWith("-") && !known.includes(arg));
    if (unknownFlags.length > 0) {
        console.error(`Unrecognised option: ${unknownFlags.join(" ")}\n`);
        printUsage();
        process.exit(2);
    }

    const words = positionals(argv);
    const commands = words.filter((word): word is Command => (COMMANDS as readonly string[]).includes(word));
    if (commands.includes("help")) return "help";

    // A word that is not a command is almost always a misspelling, and guessing at
    // one would mean writing to a real account on a typo.
    const first = words[0];
    if (first !== undefined && !commands.includes(first as Command)) {
        console.error(`Unrecognised command: ${first}\n`);
        printUsage();
        process.exit(2);
    }
    if (commands.length > 1) {
        console.error(`Pick one command; got ${commands.join(" ")}.\n`);
        printUsage();
        process.exit(2);
    }
    // No command at all is a question, not an instruction: say what the commands
    // are rather than guessing at one that would write to a real account.
    return commands[0] ?? "help";
}

export function printUsage(): void {
    console.log(`
Work with rounds on mscorecard.com, interactively.

  npx tsx src/code/mscorecard/cli/main.ts <command> [options]

Commands that create a round. Each asks for the club, which nines to play, the tee,
the player and the card, and each creates a real round on a real account.

  create-round   Create the round and score it, leaving it unfinished.
  finish-round   As create-round, then mark the round finished. It still counts
                 towards no handicap.
  submit-round   As finish-round, then mark the player's round as a handicap round
                 and submit it for WHS calculation. This reaches the Finnish Golf
                 Association and CANNOT BE UNDONE. Asks for confirmation first.

Commands that read what is already there:

  list-rounds    List recent rounds, pick one, and show its card hole by hole.
  show-round     Print one round as the server stores it. Takes a round ID, and
                 --json <file> to save the raw response. With no terminal it prints
                 and stops, so it can be piped.
  edit-round     Change the scores on a round that is still open. Takes a round ID,
                 or asks which round if none is given. The changes are shown and
                 confirmed before anything is written. A finished or submitted round
                 cannot be edited.

All three then offer whatever the round is still open to — finishing it, submitting
it as a handicap round, removing a player, or deleting it — depending on the state it
is in. A submitted round offers nothing: the federation has it.

Other:

  self-test      Create a scratch round, score it in scrambled batches, check hole
                 by hole that the server stored what was sent, then delete it.
                 Submits nothing. Use this when checking the SDK itself.
  help           Show this text. What you get if you name no command.

Options:

  --verbose      Show the detail behind checks that passed, not only failures.
  --json <file>  show-round only: save the raw response to a file.

Every create command reads the round back from the API afterwards and prints the
stored card beside the scores that were meant to go in, so it can be checked hole by
hole. submit-round prints it both before and after submitting.

Rounds are created as practice rounds; only submit-round turns that off, immediately
before submitting. They are scored as Stableford, which list-rounds can change.

Environment:

  MSCORECARD_EMAIL      account to log in as
  MSCORECARD_PASSWORD   its password
`);
}
