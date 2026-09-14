import { type HectorEvent } from "@hector/schemas/src/events.ts";
import { type HandicapHistoryEntry } from "@hector/schemas/src/handicaps.ts";
import { type HandicapCheck, lastCheckedFor } from "@hector/schemas/src/handicap-checks.ts";
import { isoInstantNow, isoDate } from "@hector/schemas/src/dates.ts";
import { bucketsFreezeAt, hectorEvents } from "./data";
import { getPlayerById, getPlayerName, getPlayerHandicapHistoryById } from "./players";
import { getHandicapChecks } from "./handicap-checks";

/**
 * A handicap under one of the two bases an event gives it, and when we last asked
 * the sources about it.
 *
 * `observed` is not when the handicap changed. A handicap only reaches this
 * repository when the scrape sees it move, so a value that has not moved since
 * August has no recent entry in the observation log and is no less current for it —
 * and the question a player actually asks, looking at a number that disagrees with
 * their eBirdie, is when we last looked. That gap is measured in hours, which is why
 * this is an instant and not a date: the Union's WHS batch runs at about 03:00 and
 * re-runs during office hours when the nightly run fails.
 *
 * Both fields are nullable and neither is ever omitted. A null `hcp` is not a zero —
 * scratch is a real handicap and so is a negative one — and a null `observed` means
 * no sweep at or before this basis answered for the player, which is also the whole
 * story for any event older than the sweep log.
 */
export type HandicapUnderBasis = {
    hcp: number | null;
    observed: string | null;
};

/**
 * What the split was drawn on, and which half of it the player landed in.
 *
 * Settles at `bucket_freeze` — 08:00 on the first morning, where the event is
 * played. `bucket` is numbered from 1 and is null for an event with no split: every
 * Hector before 2024, and any event whose split has not been drawn yet.
 */
export type BucketingBasis = HandicapUnderBasis & {
    bucket: number | null;
};

/**
 * One player in an event's field, under the two handicaps an event gives them.
 *
 * They are the same number for most of an event's life and diverge for the rest of
 * it, which is why both are published rather than one: `bucketing` stops moving at
 * `bucket_freeze`, `playing` when the event ends. Over HECTOR2024 the two differ for
 * every player in the field — rounds count, so handicaps move.
 */
export type FieldHandicapEntry = {
    id: string;
    /** The player's name as the site renders it, with any privacy shortening applied. */
    name: string;
    bucketing: BucketingBasis;
    playing: HandicapUnderBasis;
};

/**
 * An event's field and its handicaps, for app.hector.golf.
 *
 * `bucket_freeze` is when the split stops moving, published as an instant so that a
 * consumer can compare it against `generatedAt` and tell a settled split from a
 * provisional one without reimplementing the rule. Null for an event whose start
 * date cannot be resolved to one, which no committed Hector currently is.
 *
 * `handicaps_checked` is the field-wide freshness guarantee: the *oldest*
 * `playing.observed` in the file, so "every handicap here was checked at least this
 * recently" is true of all of them. A page can say "handicaps last checked at ..."
 * from it without scanning the array.
 *
 * It was the latest sweep at or before the event's last day, which is a different and
 * weaker thing: a sweep is field-wide, and the latest one may have skipped somebody
 * in *this* field — so the number could claim a freshness no player in it had. The
 * oldest of the per-player stamps cannot contradict them, because it is one of them.
 *
 * Null when any player in the field has never been checked, because then there is no
 * such guarantee to make. That covers every event older than the sweep log.
 */
export type FieldHandicapsPayload = {
    event: string;
    /** When this file was generated, i.e. when the site was last built. */
    generatedAt: string;
    bucket_freeze: string | null;
    handicaps_checked: string | null;
    handicaps: FieldHandicapEntry[];
};

/**
 * The last reading of a player's handicap on or before a given day, if the log has
 * one.
 *
 * `notObservedAfter` additionally drops a reading that had not been *taken* by then,
 * which is how the bucketing basis stays truthful now that a day can hold more than
 * one reading: a handicap dated the first morning may not have been read until that
 * afternoon, long after the split froze. A reading with no `observed` predates the
 * field, and therefore predates any freeze that could be asked about, so it passes.
 */
const readingAsOf = (
    history: HandicapHistoryEntry[],
    asOf: string,
    notObservedAfter?: string,
): HandicapHistoryEntry | undefined =>
    history
        .filter((entry) => entry.date <= asOf)
        .filter((entry) => !notObservedAfter || !entry.observed || entry.observed <= notObservedAfter)
        .at(-1);

/**
 * Orders the field the way it is read: lowest playing handicap first.
 *
 * The participants list is in whatever order the event file happens to be in, and a
 * handicap list is looked at as a ranking. A player with no handicap sorts last
 * rather than as a zero, and name breaks ties so that the file is stable across
 * builds — a list that reshuffles itself every deploy makes every diff a lie.
 */
const byPlayingHandicapThenName = (a: FieldHandicapEntry, b: FieldHandicapEntry): number => {
    const [x, y] = [a.playing.hcp, b.playing.hcp];
    if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
        return x - y;
    }
    return a.name.localeCompare(b.name);
};

/**
 * The oldest `playing.observed` in the field — what the whole file is at least as
 * fresh as.
 *
 * One unchecked player and there is no guarantee left to make, so the answer is
 * null rather than the oldest of the others: "all of these were checked by X" has to
 * be true of all of them or it is not worth publishing.
 */
const freshnessGuarantee = (handicaps: readonly FieldHandicapEntry[]): string | null => {
    if (handicaps.length === 0) return null;
    let oldest: string | null = null;
    for (const player of handicaps) {
        if (player.playing.observed === null) return null;
        if (oldest === null || player.playing.observed < oldest) oldest = player.playing.observed;
    }
    return oldest;
};

/** A player's placement in the split, and the handicap it was drawn on. */
type Placement = { bucket: number; handicap: number | undefined };

/**
 * The split as it was actually drawn, by player id.
 *
 * Read from the committed event file rather than from the `HectorEvent` handed in,
 * because `populateUpdatedHandicaps` replaces exactly these handicaps with current
 * ones for any event that is not yet past — which includes every event between its
 * bucket freeze and its last day, the window in which the two handicaps differ and
 * the only window in which this file is being polled. Taking them from the enriched
 * event would publish the playing handicap twice under two names.
 *
 * Empty for an event with no split, which leaves the log to answer instead.
 */
const placements = (eventId: string): Map<string, Placement> => {
    const committed = hectorEvents.find((event) => event.id === eventId);
    return new Map(
        (committed?.buckets ?? []).flatMap((bucket, index) =>
            bucket.map((player): [string, Placement] => [player.id, { bucket: index + 1, handicap: player.handicap }]),
        ),
    );
};

/** The days a handicap's value is read as of, and the instants the sweep log is. */
type Bases = {
    value: { bucketing: string; playing: string };
    checked: { bucketing: string | null; playing: string };
    eventIsOver: boolean;
    checks: HandicapCheck[];
};

/**
 * One player under both bases.
 *
 * The bucketing handicap prefers the number frozen into the event file, because that
 * is not a reading of anything — it is the figure the split was computed from, and
 * the split is the thing it has to agree with. The log answers only where the file
 * does not: an event with no buckets, or a participant left out of them.
 *
 * The playing handicap defers to `getPlayerById` while the event is live, so this
 * file and the event page can never disagree about a number — a hand-set handicap
 * wins over the log there, because it exists precisely for the player the scrape has
 * no figure for. Once the event is over it reads the log alone: a stopgap set today
 * is not what anyone played off, and neither is a reading taken since.
 */
const entryFor = (id: string, bases: Bases, split: Map<string, Placement>): FieldHandicapEntry => {
    const history = getPlayerHandicapHistoryById(id);
    const atBucketing = readingAsOf(history, bases.value.bucketing, bases.checked.bucketing ?? undefined);
    const atPlaying = readingAsOf(history, bases.value.playing);
    const placement = split.get(id);
    return {
        id,
        name: getPlayerName(id),
        bucketing: {
            bucket: placement?.bucket ?? null,
            hcp: placement?.handicap ?? atBucketing?.handicap ?? null,
            observed: lastCheckedFor(bases.checks, id, bases.checked.bucketing ?? undefined) ?? null,
        },
        playing: {
            hcp: (bases.eventIsOver ? atPlaying?.handicap : getPlayerById(id)?.handicap) ?? null,
            observed: lastCheckedFor(bases.checks, id, bases.checked.playing) ?? null,
        },
    };
};

/** An event's field and its handicaps, as published at `/events/hector/<id>/handicaps.json`. */
export function fieldHandicaps(event: HectorEvent, now: Date = new Date()): FieldHandicapsPayload {
    const today = isoDate(now);
    // `isPastEvent` with the clock passed in, which it does not take.
    const eventIsOver = event.timing.end < today;
    const bucketFreeze = bucketsFreezeAt(event)?.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
    const bases: Bases = {
        // The split settles on the first morning and the playing handicap on the last
        // day, so those are the days each is read as of — but never before that day
        // has happened, or a file built a week out would claim a reading from the
        // future.
        value: {
            bucketing: event.timing.start < today ? event.timing.start : today,
            playing: eventIsOver ? event.timing.end : today,
        },
        checked: {
            bucketing: bucketFreeze,
            // As of the last day rather than of now, for the same reason the handicaps
            // are: a sweep run in 2026 says nothing about the field that played in
            // 2024. A live event is capped at `now` instead — the log cannot hold a
            // sweep from the future in production, but this function's answer should
            // depend on the clock it is given rather than on that being true.
            playing: eventIsOver ? `${event.timing.end}T23:59:59Z` : isoInstantNow(now),
        },
        eventIsOver,
        checks: getHandicapChecks(),
    };
    const split = placements(event.id);
    const handicaps = event.participants.map((id) => entryFor(id, bases, split)).sort(byPlayingHandicapThenName);
    return {
        event: event.id,
        generatedAt: isoInstantNow(now),
        bucket_freeze: bucketFreeze,
        // Derived from the entries rather than from the log, so it cannot disagree
        // with them: it is one of the values above, not a fourth reading of the log.
        handicaps_checked: freshnessGuarantee(handicaps),
        handicaps,
    };
}
