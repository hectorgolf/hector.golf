import { z } from 'zod';

import { isValidIsoInstant } from './dates.ts';

/**
 * One sweep of the handicap sources, whether or not it found anything.
 *
 * Append-only and never pruned, like the observation log beside it. A Hector's
 * buckets and the handicaps they were drawn on live in the event file for good, and
 * an explanation that expires after a season would leave the 2026 split standing in
 * 2036 with nothing left to say about how it came about. At roughly 57KB a year this
 * is not a file worth trimming — half of what `handicaps.json` already holds, per
 * decade.
 *
 * `handicaps.json` records what changed; this records that we looked. The two
 * answer different questions and a quiet day is exactly where they come apart: a
 * player whose handicap has not moved since August has no entry in the observation
 * log to cite, and "we checked at 03:02 this morning and it is still 15.4" is the
 * thing the events page needs to say. Without this file that sentence is
 * unsayable — the scrape's own timestamp is discarded when nothing changes.
 *
 * What it is for, concretely: a player looking at a bucketing handicap that
 * disagrees with what their eBirdie shows. The difference is timing, and timing is
 * only demonstrable with the moment we last asked.
 */
export const schema = z.object({
    /** When the sweep read the sources, e.g. "2026-09-14T03:02:42Z". */
    at: z
        .string()
        .refine(isValidIsoInstant, {
            message: 'expected a UTC instant to the second, e.g. 2026-09-14T03:02:42Z',
        }),

    /** How many players the sources answered for. */
    checked: z.number().int().nonnegative(),

    /**
     * The players the sweep did not get a handicap for, by id.
     *
     * Two causes, deliberately not told apart: a player with no club is not asked
     * about at all, and a player whose sources all failed was asked and got nothing.
     * Neither was checked, which is the only thing a reader of this file acts on.
     *
     * A list rather than a count because `lastCheckedFor` has to answer per player,
     * and a list of the exceptions stays small — usually empty — where a list of the
     * checked would repeat the whole roster twice a day.
     */
    skipped: z.array(z.string()),
})

export type HandicapCheck = z.infer<typeof schema>;

/** Sweeps oldest first. */
export function compareChecks(a: HandicapCheck, b: HandicapCheck): number {
    return a.at.localeCompare(b.at);
}

/**
 * The most recent sweep at or before an instant, or the most recent of all when no
 * instant is given.
 *
 * The `asOf` argument is what makes a frozen event answerable. A Hector's buckets
 * settle on the first morning and the sweeps carry on twice a day for years
 * afterwards, so "when had we last checked" has to be asked as of the freeze or it
 * reports a sweep that happened long after the split it is supposed to explain.
 */
export function latestCheck(checks: readonly HandicapCheck[], asOf?: string): HandicapCheck | undefined {
    return [...checks]
        .sort(compareChecks)
        .filter((check) => !asOf || check.at <= asOf)
        .at(-1);
}

/**
 * When a player's handicap was last checked, as of an instant.
 *
 * The latest sweep that did not skip them. A player the sources have never answered
 * for gets undefined rather than the sweep's own timestamp, which is the point of
 * recording `skipped` at all: "we checked everyone at 03:02" is false for the player
 * whose club is unknown, and they are the likeliest person to ask.
 *
 * One inaccuracy, in the harmless direction: a player added to the roster after a
 * sweep is not named in that sweep's `skipped`, so this reads them as checked by it.
 * The answer is at most one sweep interval too old-looking, and corrects itself at
 * the next sweep.
 */
export function lastCheckedFor(
    checks: readonly HandicapCheck[],
    player: string,
    asOf?: string,
): string | undefined {
    return [...checks]
        .sort(compareChecks)
        .filter((check) => !asOf || check.at <= asOf)
        .filter((check) => !check.skipped.includes(player))
        .at(-1)?.at;
}

export default schema;
