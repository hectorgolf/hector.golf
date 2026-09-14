import { type HectorEvent } from "@hector/schemas/src/events.ts";
import { type HandicapHistoryEntry } from "@hector/schemas/src/handicaps.ts";
import { type HandicapCheck, latestCheck, lastCheckedFor } from "@hector/schemas/src/handicap-checks.ts";
import { isoInstantNow, isoDate } from "@hector/schemas/src/dates.ts";
import { bucketsFreezeAt, hectorEvents } from "./data";
import { getPlayerById, getPlayerName, getPlayerHandicapHistoryById } from "./players";
import { getHandicapChecks } from "./handicap-checks";

/**
 * One player in an event's field, under the two handicaps an event gives them.
 *
 * They are the same number for most of an event's life and diverge for the rest of
 * it, which is why both are published rather than one: the bucketing handicap stops
 * moving at `bucket_freeze`, the playing handicap when the event ends.
 *
 * Every field is nullable and none is ever omitted, so a consumer reads the same
 * shape for a Hector played next month and one played in 2014. A null handicap is
 * not a zero — scratch is a real handicap and so is a negative one — and a null
 * `_date` means the observation log does not account for the number beside it: a
 * hand-set handicap, a bucketing figure no surviving reading matches, or a reading
 * the log does not reach back far enough to hold.
 */
export type FieldHandicapEntry = {
    id: string;
    /** The player's name as the site renders it, with any privacy shortening applied. */
    name: string;
    /** Which half of the split they are in, numbered from 1, or null if there is none. */
    bucket: number | null;
    /**
     * What the split was drawn on, and when we last *asked* the sources about this
     * player before it froze.
     *
     * Not when the handicap last changed, which is the question the observation log
     * answers and the wrong one here. The two together are what settles "my eBirdie
     * shows something else": the gap is timing, and timing is only demonstrable with
     * the moment we last looked. A handicap that has not moved since August has no
     * recent entry in the observation log to cite and is no less current for it.
     *
     * Read as of `bucket_freeze`, because a sweep that ran after the split settled
     * cannot be what the split was drawn from. Null for a player no sweep has
     * answered for, and for every event older than the sweep log itself.
     */
    bucketing_hcp: number | null;
    bucketing_hcp_observed: string | null;
    /** What they play off, and the day that number belongs to. */
    playing_hcp: number | null;
    playing_hcp_date: string | null;
};

/**
 * An event's field and its handicaps, for app.hector.golf.
 *
 * `bucket_freeze` is when the split stops moving — 08:00 on the first morning where
 * the event is played (see `bucketsFreezeAt`) — published as an instant so that a
 * consumer can compare it against `generatedAt` and tell a settled split from a
 * provisional one without reimplementing the rule. Null for an event whose start
 * date cannot be resolved to one, which no committed Hector currently is.
 *
 * There is no separate list of buckets: the split is the `bucket` field, which
 * keeps every number about a player next to the player.
 */
export type FieldHandicapsPayload = {
    event: string;
    /** When this file was generated, i.e. when the site was last built. */
    generatedAt: string;
    bucket_freeze: string | null;
    /**
     * When the field's handicaps were last swept, whatever the sweep found.
     *
     * The whole-field version of `bucketing_hcp_observed`, here so a page can say
     * "handicaps last checked at ..." without scanning the array — and read as of the
     * same moment the handicaps below are, so a finished event reports the sweep that
     * stood while it was played rather than one from years later. Null for an event
     * older than the sweep log.
     */
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
 * afternoon, long after the split froze, and stamping the split with that moment
 * would say the opposite of what the timestamp is published to say. A reading with
 * no `observed` predates the field, and therefore predates any freeze that could be
 * asked about, so it passes.
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
 * The reading to publish a handicap's provenance from — but only if the reading is
 * what produced it.
 *
 * The two can come apart, and every case where they do is a case where dating the
 * number from that reading would misdate it: a hand-set handicap sits in front of
 * the log without replacing it, and a bucketing handicap frozen into the event file
 * outlives the reading behind it.
 */
const behind = (
    handicap: number | null,
    source: HandicapHistoryEntry | undefined,
): HandicapHistoryEntry | undefined => (source !== undefined && source.handicap === handicap ? source : undefined);

/**
 * Orders the field the way it is read: lowest playing handicap first.
 *
 * The participants list is in whatever order the event file happens to be in, and a
 * handicap list is looked at as a ranking. A player with no handicap sorts last
 * rather than as a zero, and name breaks ties so that the file is stable across
 * builds — a list that reshuffles itself every deploy makes every diff a lie.
 */
const byPlayingHandicapThenName = (a: FieldHandicapEntry, b: FieldHandicapEntry): number => {
    const [x, y] = [a.playing_hcp, b.playing_hcp];
    if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
        return x - y;
    }
    return a.name.localeCompare(b.name);
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
const entryFor = (
    id: string,
    asOf: {
        bucketing: string;
        playing: string;
        eventIsOver: boolean;
        bucketFreeze: string | null;
        checks: HandicapCheck[];
    },
    split: Map<string, Placement>,
): FieldHandicapEntry => {
    const history = getPlayerHandicapHistoryById(id);
    const atBucketing = readingAsOf(history, asOf.bucketing, asOf.bucketFreeze ?? undefined);
    const atPlaying = readingAsOf(history, asOf.playing);
    const placement = split.get(id);
    const bucketing = placement?.handicap ?? atBucketing?.handicap ?? null;
    const playing = (asOf.eventIsOver ? atPlaying?.handicap : getPlayerById(id)?.handicap) ?? null;
    return {
        id,
        name: getPlayerName(id),
        bucket: placement?.bucket ?? null,
        bucketing_hcp: bucketing,
        bucketing_hcp_observed: lastCheckedFor(asOf.checks, id, asOf.bucketFreeze ?? undefined) ?? null,
        playing_hcp: playing,
        playing_hcp_date: behind(playing, atPlaying)?.date ?? null,
    };
};

/** An event's field and its handicaps, as published at `/events/hector/<id>/handicaps.json`. */
export function fieldHandicaps(event: HectorEvent, now: Date = new Date()): FieldHandicapsPayload {
    const today = isoDate(now);
    const bucketFreeze = bucketsFreezeAt(event)?.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
    const checks = getHandicapChecks();
    const asOf = {
        // The split settles on the first morning, so that is the day it is read as
        // of — but not before that day has happened, or a file built a week out would
        // claim a reading from the future. Same for the playing handicap and the last
        // day: `isPastEvent`, with the clock passed in, which it does not take.
        bucketing: event.timing.start < today ? event.timing.start : today,
        playing: event.timing.end < today ? event.timing.end : today,
        eventIsOver: event.timing.end < today,
        bucketFreeze,
        checks,
    };
    const split = placements(event.id);
    return {
        event: event.id,
        generatedAt: isoInstantNow(now),
        bucket_freeze: bucketFreeze,
        // As of the last day rather than of now, for the same reason the handicaps are:
        // a sweep run in 2026 says nothing about the field that played in 2024. A live
        // event is capped at `now` instead — the log cannot hold a sweep from the
        // future in production, but this function's answer should depend on the clock
        // it is given rather than on that being true.
        handicaps_checked:
            latestCheck(
                checks,
                asOf.eventIsOver ? `${event.timing.end}T23:59:59Z` : isoInstantNow(now),
            )?.at ?? null,
        handicaps: event.participants.map((id) => entryFor(id, asOf, split)).sort(byPlayingHandicapThenName),
    };
}
