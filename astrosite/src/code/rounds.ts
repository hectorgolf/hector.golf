import { addDays, weekdayOf, type IsoDate } from "./dates";

/** What an event has to tell us to place a round on the calendar. */
type ScheduledEvent = {
    timing: { start: IsoDate };
    rounds?: Array<{ day: number }>;
};

/** Where a round sits in the schedule: which day of the event, and which round of that day. */
type ScheduledRound = {
    day: number;
    round: number;
};

/**
 * The date a round is played.
 *
 * A round records its day as an offset into the event rather than a date of its
 * own, and day 1 is the event's first day — so day 3 of an event starting on the
 * 24th is the 26th.
 *
 * @param event The event the round belongs to.
 * @param round The round.
 * @returns The round's date in ISO format (yyyy-mm-dd).
 */
export function dateOfRound(event: ScheduledEvent, round: ScheduledRound): IsoDate {
    return addDays(event.timing.start, round.day - 1);
}

/**
 * The part of the day a round is played, by its position within that day.
 *
 * Nothing in the data records a tee time, so this is inferred from the ordering: a
 * day's first round is the morning one and its second the afternoon one. That
 * inference needs two rounds to stand on, which is why a day holding only one round
 * gets no time of day at all rather than a guessed "morning".
 */
function timeOfDay(round: ScheduledRound, roundsThatDay: number): string | undefined {
    if (roundsThatDay < 2) return undefined;
    switch (round.round) {
        case 1:
            return "morning";
        case 2:
            return "afternoon";
        case 3:
            return "evening";
        default:
            return undefined;
    }
}

/**
 * How a round reads in the schedule: "Saturday morning".
 *
 * The weekday comes from the event's start date plus the round's day offset, so it
 * is the real weekday rather than a "Day 3" the reader has to count out. A day with
 * a single round is named by its weekday alone — see `timeOfDay`.
 *
 * @param event The event the round belongs to.
 * @param round The round.
 * @returns The round's title for display.
 */
export function titleOfRound(event: ScheduledEvent, round: ScheduledRound): string {
    const weekday = weekdayOf(dateOfRound(event, round));
    const roundsThatDay = (event.rounds ?? []).filter((r) => r.day === round.day).length;
    const partOfDay = timeOfDay(round, roundsThatDay);
    return partOfDay ? `${weekday} ${partOfDay}` : weekday;
}
