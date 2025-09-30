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
} from "../schemas/events";
import { type Course, schema as CourseSchema } from "../schemas/courses";
import { type Player, schema as PlayerSchema } from "../schemas/players";
import { isoDate, isoDateToday, parseEventDateRange } from "../code/dates.ts";

const __filename = fileURLToPath(import.meta.url);

export function pathToEventJson(event: Event): string {
    return join(dirname(__filename), `../data/events/${event.format}/${event.id}.json`);
}

export function pathToPlayerJson(player: Player): string {
    return join(dirname(__filename), `../data/players/${player.id}.json`);
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
    return isoDate(parseEventDateRange(event.date)?.startDate) >= isoDateToday();
}

/**
 * Filter function for selecting past events.
 *
 * @param event `Event` object to evaluate the predicate against.
 * @returns true if the `Event`'s start date is either today or in the future.
 */
export function isPastEvent(event: Event | undefined): boolean {
    if (!event) return false;
    return isoDate(parseEventDateRange(event.date)?.endDate) < isoDateToday();
}

export function yearOfEvent(event: HectorEvent|MatchplayEvent|FinnkampenEvent): number {
	return parseYearFromDate(event.date)
}

function parseYearFromDate(date: string): number {
	return parseInt(date.match(/\d{4}$/)?.[0] || '0')
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
 * @param player The Player object or player ID to find the path for.
 * @returns The path to the player's data file, or `undefined` if the player is not found.
 */
export async function playerDataPath(player: Player|string): Promise<string | undefined> {
    return (await glob("src/data/players/**/*.json")).find((filePath) => {
        const p = PlayerSchema.safeParse(JSON.parse(readFileSync(filePath, "utf-8"))).data;
        return p?.id === player || p?.id === (player as Player)?.id;
    });
}
