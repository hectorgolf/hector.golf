import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

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

/**
 * The bucketing rules live in `@hector/schemas` so that the admin service can import
 * them; this module cannot be imported at all, because it globs the filesystem at
 * module scope. Re-exported here so the site's call sites keep their import.
 */
export {
    BUCKETS_FREEZE_AT_HOUR,
    bucketsAreOpen,
    bucketsFreezeAt,
    hasParticipants,
} from "@hector/schemas/src/buckets.ts";

const __filename = fileURLToPath(import.meta.url);

/**
 * The path an event's data file lives at.
 *
 * Deriving the path from the id is safe because every file is named after the id
 * it holds — all 18 events as `{format}/{id}.json`, and, since 2026-09-21, all 45
 * players as `players/{id}.json`. It did not hold for players until then, which
 * is why there used to be a `playerDataPath()` that opened the files and matched
 * on `id` instead. `test/unit/player-data-paths.test.ts` is what keeps the
 * naming true; nothing in this package writes a player any more.
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

