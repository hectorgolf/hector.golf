import { writeFileSync } from "fs";

/**
 * How this repository's JSON data files are written.
 *
 * Every writer goes through here, because they used to disagree. Five call sites
 * wrote two-space and three wrote four-space, so an event file touched by the
 * handicap job came back two-space and the same file touched by the leaderboard
 * job came back four-space — a diff of several hundred lines with no change to a
 * single value. Two of the data directories still carry the scars.
 *
 * Four spaces and a trailing newline is what the hand-edited files carry, and
 * four spaces is what the TypeScript around them uses.
 *
 * `test/unit/data-formatting.test.ts` holds the files on disk to this, so the
 * convention is checked rather than merely written down.
 */
export const JSON_INDENT = 4;

/** Serialises a value the way every data file in this repository is written. */
export function serializeJson(value: unknown): string {
    return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

/**
 * Writes a data file, formatted as the rest of them are.
 *
 * Prefer this over `writeFileSync` plus `JSON.stringify` anywhere the result is
 * committed to the repository.
 */
export function writeJsonFile(path: string, value: unknown): void {
    writeFileSync(path, serializeJson(value));
}
