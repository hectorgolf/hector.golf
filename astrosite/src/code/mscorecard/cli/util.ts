/** Small helpers shared across the CLI. */

import { MScorecardError } from "../index.ts";

export function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * A problem with how the command was run, rather than a bug.
 *
 * Reported as a plain message; anything else keeps its stack trace, because an
 * unexpected error is one where the stack is the useful part.
 */
export class CliError extends Error {}

/**
 * Whether an error is the user pressing Ctrl-C at a prompt.
 *
 * `readline/promises` rejects the pending question with an `AbortError` rather than
 * killing the process, so without this it surfaces as an unhandled rejection and a
 * stack trace. The name is checked as well as the code, since only the code is
 * documented and neither is guaranteed across versions.
 */
export function isInterrupt(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const { code, name } = error as { code?: string; name?: string };
    return code === "ABORT_ERR" || name === "AbortError";
}

/** The conventional exit code for a process stopped with Ctrl-C. */
export const INTERRUPTED = 130;

/** How a failure should be reported, or undefined when it should keep its stack. */
export type Outcome = { text: string; toStderr: boolean; code: number };

/**
 * Decides how a failure leaves the process.
 *
 * Ctrl-C and a misuse of the command are ordinary outcomes and get a plain line.
 * Anything else returns undefined so the caller rethrows: an unexpected error is one
 * where the stack trace is the useful part.
 */
export function outcomeFor(error: unknown): Outcome | undefined {
    if (isInterrupt(error)) return { text: "\nCancelled.", toStderr: false, code: INTERRUPTED };
    if (error instanceof CliError || error instanceof MScorecardError) {
        return { text: `\n${error.message}`, toStderr: true, code: 1 };
    }
    return undefined;
}
