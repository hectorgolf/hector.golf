import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import { DateTime } from "luxon";

import {
    type Event,
    type FinnkampenEvent,
    type HectorEvent,
    type MatchplayEvent,
    genericEventSchema as EventSchema,
} from "@hector/schemas/src/events.ts";
import { type Course, schema as CourseSchema } from "@hector/schemas/src/courses.ts";
import { type Player, schema as PlayerSchema } from "@hector/schemas/src/players.ts";
import { isoDateToday, parseIsoDate } from "@hector/schemas/src/dates.ts";

const __filename = fileURLToPath(import.meta.url);

/**
 * The path an event's data file lives at.
 *
 * Deriving the path from the id is only safe because it holds for events: all 18
 * of them are named `{format}/{id}.json`. It does *not* hold for players — every
 * one of the 45 player files has a filename that differs from the record's id
 * (`anders-forss.json` holds `"id": "anders-f"`) — so there is deliberately no
 * player counterpart to this function. Use `playerDataPath()` below, which finds
 * the file by reading it, and `updatePlayerData()` in `players.ts` to write one.
 */
export function pathToEventJson(event: Event): string {
    return join(dirname(__filename), `../data/events/${event.format}/${event.id}.json`);
}

/**
 * Filter function for dropping undefined values.
 *
 * @param x Candidate value.
 * @returns true if the value is defined (and presumably of the right type), false if it is `undefined`.
 */
export function nonUndefined<T>(value: T | undefined | null): value is T {
    return value !== undefined && value !== null;
}

/**
 * Filter function for dropping non-`HectorEvent` values.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event` is a `HectorEvent`.
 */
export function isHectorEvent(
    event: Event | HectorEvent | MatchplayEvent | FinnkampenEvent | undefined
): event is HectorEvent {
    return event?.format === "hector";
}

/**
 * Filter function for dropping non-`MatchplayEvent` values.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event` is a `MatchplayEvent`.
 */
export function isMatchplayEvent(
    event: Event | HectorEvent | MatchplayEvent | FinnkampenEvent | undefined
): event is MatchplayEvent {
    return event?.format === "matchplay";
}

/**
 * Filter function for dropping non-`MatchplayEvent` values.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event` is a `MatchplayEvent`.
 */
export function isFinnkampenEvent(
    event: Event | HectorEvent | MatchplayEvent | FinnkampenEvent | undefined
): event is FinnkampenEvent {
    return event?.format === "finnkampen";
}

/**
 * Filter function for selecting future events.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event`'s start date is either today or in the future.
 */
export function isUpcomingEvent(event: Event | undefined): boolean {
    if (!event) return false;
    return event.timing.start >= isoDateToday();
}

/**
 * The hour of the first morning at which a Hector's buckets stop moving.
 *
 * Local to the event, not to whatever is running the job.
 */
export const BUCKETS_FREEZE_AT_HOUR = 8;

/**
 * True while an event's buckets may still be recomputed.
 *
 * The buckets decide the Draft after round one, where each player picks a partner
 * from the opposite bucket, so they have to be settled before anyone tees off —
 * and they are derived from handicaps, which the scrape keeps moving. A player
 * whose handicap changes on the first morning would otherwise be moved between
 * buckets underneath a Draft that is about to use them.
 *
 * `isUpcomingEvent` is not the boundary: it compares calendar dates, so it stays
 * true for the whole of the first day, and the handicap job's second run of the
 * day is at 13:00 UTC — mid-afternoon at a European venue, long after the first
 * tee time and very possibly after the Draft itself.
 *
 * Without `timing.timezone` there is no way to know when 08:00 on the first
 * morning was, so the buckets close at the start of that date in UTC instead.
 * That is earlier than the intended cutoff everywhere east of Greenwich and never
 * later, which is the direction to be wrong in: buckets that stopped too early are
 * a stale split, buckets that stopped too late are a Draft played against a
 * different one than the players were shown.
 */
export function bucketsAreOpen(event: Event | undefined, now: Date = new Date()): boolean {
    if (!event) return false;
    const zone = event.timing.timezone ?? "UTC";
    const hour = event.timing.timezone ? BUCKETS_FREEZE_AT_HOUR : 0;
    const freezesAt = DateTime.fromISO(event.timing.start, { zone }).set({ hour });
    if (!freezesAt.isValid) return false;
    return now.getTime() < freezesAt.toMillis();
}

/**
 * Filter function for selecting past events.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event`'s start date is either today or in the future.
 */
export function isPastEvent(event: Event | undefined): boolean {
    if (!event) return false;
    return event.timing.end < isoDateToday();
}

export function hasRecentlyEnded(event: Event): boolean {
    const endDate = parseIsoDate(event.timing.end);
    const today = new Date();
    const daysSinceEnd = (today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceEnd >= 0 && daysSinceEnd <= 21; // within three weeks
}

export function yearOfEvent(event: HectorEvent|MatchplayEvent|FinnkampenEvent): number {
	return parseIsoDate(event.timing.end).getFullYear()
}

export function endDateOfEvent(event: Event): Date {
    return parseIsoDate(event.timing.end)
}

/**
 * Filter function for dropping `Event`s without participants.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event` has participants.
 */
export function hasParticipants(event: Event | undefined): boolean {
    return (event?.participants?.length || 0) > 0;
}

/**
 * All `Event` objects found from `src/data/events/`.
 */
export const eventsData: Event[] = (await glob("src/data/events/**/*.json"))
    .map((filePath) => {
        return EventSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
    })
    .filter(nonUndefined);

/**
 * All `Event` objects found from `src/data/events/`.
 */
export const hectorEvents: HectorEvent[] = (await glob("src/data/events/**/*.json"))
    .map((filePath) => {
        return EventSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
    })
    .filter(isHectorEvent);

/**
 * All `Course` objects found from `src/data/courses/`.
 */
export const coursesData: Course[] = (await glob("src/data/courses/**/*.json"))
    .map((filePath) => {
        return CourseSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
    })
    .filter(nonUndefined);

/**
 * All `Player` objects found from `src/data/players/`.
 */
export const playersData: Player[] = (await glob("src/data/players/**/*.json"))
    .map((filePath) => {
        return PlayerSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
    })
    .filter(nonUndefined);

/**
 * Find the path to the player's data file.
 *
 * The filenames do not follow from the ids, so the only way to find a player's
 * file is to open the files and match on `id`. Any writer of player data has to
 * go through here — see `updatePlayerData()` in `players.ts`, and the regression
 * test in `test/unit/player-data-paths.test.ts`.
 *
 * @param player The Player object or player ID to find the path for.
 * @returns The path to the player's data file, or `undefined` if the player is not found.
 */
export async function playerDataPath(player: Player|string): Promise<string | undefined> {
    return (await glob("src/data/players/**/*.json")).find((filePath) => {
        const p = PlayerSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
        return p?.id === player || p?.id === (player as Player)?.id;
    });
}
