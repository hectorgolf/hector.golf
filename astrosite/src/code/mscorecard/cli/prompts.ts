/**
 * Terminal prompts.
 *
 * The readline interface is owned by a `Prompter` rather than a module-level
 * singleton, so the rest of the CLI takes it as an argument and nothing has to
 * import a live stdin handle just to be loaded.
 */

import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { CliError, INTERRUPTED } from "./util.ts";

export type Prompter = {
    /** Presents a numbered menu and returns the chosen item. Auto-picks a sole option. */
    choose<T>(label: string, items: readonly T[], render: (item: T) => string): Promise<T>;
    /** Asks for a value, offering a default that Enter accepts. */
    ask(label: string, fallback: string): Promise<string>;
    /**
     * Asks before writing. `strict` demands the whole word rather than a keystroke,
     * and is reserved for the submit — the one action that cannot be taken back.
     */
    confirm(label: string, strict?: boolean): Promise<boolean>;
    close(): void;
};

/** Whether there is a terminal to ask questions on. */
export function isInteractive(): boolean {
    return Boolean(stdin.isTTY);
}

/**
 * Opens stdin for prompting.
 *
 * Refuses outright when there is no terminal, rather than hanging on a prompt
 * nobody can answer — which is what a CI run or a piped invocation would otherwise
 * do, after having already logged in.
 */
export function createPrompter(): Prompter {
    if (!stdin.isTTY) {
        throw new CliError("This command is interactive — run it from a terminal.");
    }
    const rl: Interface = createInterface({ input: stdin, output: stdout });

    // Ctrl-C with no question pending arrives here instead of as a rejected
    // promise, and readline swallows the default handling, so nothing else would
    // stop the run.
    rl.on("SIGINT", () => {
        rl.close();
        console.log("\nCancelled.");
        process.exit(INTERRUPTED);
    });

    return {
        async choose<T>(label: string, items: readonly T[], render: (item: T) => string): Promise<T> {
            if (items.length === 0) throw new Error(`Nothing to choose from for ${label}.`);
            if (items.length === 1) {
                console.log(`\n${label}: ${render(items[0]!)} (only option)`);
                return items[0]!;
            }
            console.log(`\n${label}:`);
            items.forEach((item, index) => console.log(`  ${String(index + 1).padStart(2)}) ${render(item)}`));
            for (;;) {
                const answer = (await rl.question(`Select 1-${items.length}: `)).trim();
                const index = Number(answer);
                if (Number.isInteger(index) && index >= 1 && index <= items.length) return items[index - 1]!;
                console.log(`"${answer}" is not one of 1-${items.length}.`);
            }
        },

        async ask(label: string, fallback: string): Promise<string> {
            const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
            return answer === "" ? fallback : answer;
        },

        async confirm(label: string, strict = false): Promise<boolean> {
            const prompt = strict ? 'type "yes" to proceed' : "y/n";
            const answer = (await rl.question(`${label} (${prompt}): `)).trim().toLowerCase();
            return strict ? answer === "yes" : answer === "y" || answer === "yes";
        },

        close: () => rl.close(),
    };
}

/** An environment variable the CLI cannot run without. */
export function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new CliError(`${name} is not set.`);
    return value;
}
