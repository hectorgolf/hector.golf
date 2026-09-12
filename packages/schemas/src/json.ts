/**
 * How this repository's JSON data files are written.
 *
 * Lives beside the schemas because both sides of the migration need it: the
 * site's workflows write these files, and so does the admin's export. A second
 * copy in the admin would be a second convention waiting to disagree with this
 * one, which is the exact problem this function was extracted to solve.
 *
 * Every writer goes through here, because they used to disagree. Five call sites
 * wrote two-space and three wrote four-space, so an event file touched by the
 * handicap job came back two-space and the same file touched by the leaderboard
 * job came back four-space — a diff of several hundred lines with no change to a
 * single value.
 *
 * Two spaces, because it is what 54 of the 71 files here already carry and what
 * every other JSON file in the repository uses — package.json, the tsconfigs and
 * the editor settings alike. It also keeps merges quiet: a file that only needs a
 * trailing newline does not collide with a bot that changed a value inside it.
 *
 * `astrosite/test/unit/data-formatting.test.ts` holds the files on disk to this,
 * so the convention is checked rather than merely written down.
 */
export const JSON_INDENT = 2;

/** Serialises a value the way every data file in this repository is written. */
export function serializeJson(value: unknown): string {
    return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}
