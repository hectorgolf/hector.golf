/**
 * A calendar date with no time of day, spelled the way the data files spell it:
 * "2026-09-24".
 *
 * Events are stored as a start date and an end date in this form rather than as a
 * prose range like "September 24-27, 2026", so that the day a round is played is
 * something the site can compute instead of something it has to parse back out of
 * English.
 */
export type IsoDate = string;

/**
 * A moment in time, to the second, always in UTC: "2026-09-13T03:02:42Z".
 *
 * Distinct from `IsoDate` in what it is for. A date says which day something is
 * *about*; an instant says when we *saw* it. The two answer different questions
 * and a handicap entry carries both, because the answers can differ by most of a
 * day — see `docs/handicap-updates.md`.
 *
 * Always UTC, and spelled with the `Z`, so that two instants can be compared as
 * strings and so that no reader has to ask which zone a file was written in.
 */
export type IsoInstant = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Gets the given date in ISO format (yyyy-mm-dd).
 *
 * @param date The `Date` object to convert to an ISO format `string`.
 * @returns The date in ISO format (yyyy-mm-dd) or an empty string if the provided date was `undefined`.
 */
export const isoDate = (date: Date|undefined): IsoDate => {
    if (!date) return '';
    const pad = (n: number): string => String(n).padStart(2, '0');
    // Built from the local calendar fields rather than `toISOString()`, which would
    // convert to UTC first and hand back the neighbouring day west of Greenwich.
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Get the current date in ISO format (yyyy-mm-dd)
 * @returns the current date in ISO format (yyyy-mm-dd)
 */
export const isoDateToday = (): IsoDate => isoDate(new Date());

/**
 * The current moment as an `IsoInstant`.
 *
 * Seconds are the finest resolution kept. `toISOString()` offers milliseconds and
 * nothing here is timed that closely — the things being stamped happen minutes or
 * hours apart — so the extra digits would be noise in a file people read.
 */
export const isoInstantNow = (now: Date = new Date()): IsoInstant =>
    now.toISOString().replace(/\.\d+Z$/, "Z");

/**
 * True if the string is a moment in UTC, to the second, spelled "2026-09-13T03:02:42Z".
 *
 * Deliberately narrower than ISO 8601 allows. An offset other than `Z`, a missing
 * `Z`, or fractional seconds are all rejected rather than normalised, so that every
 * instant in the data reads the same way and sorts as a string.
 */
export function isValidIsoInstant(value: string): boolean {
    const match = value.match(ISO_INSTANT_PATTERN);
    if (!match) return false;
    const [, date, hours, minutes, seconds] = match;
    if (!isValidIsoDate(date)) return false;
    return Number(hours) < 24 && Number(minutes) < 60 && Number(seconds) < 60;
}

/**
 * True if the string is a real calendar date in ISO format.
 *
 * The pattern alone is not enough: "2026-02-30" matches it and does not exist, and
 * `Date` would quietly roll it over into March.
 */
export function isValidIsoDate(date: string): boolean {
    const match = date.match(ISO_DATE_PATTERN);
    if (!match) return false;
    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
    return (
        parsed.getFullYear() === Number(year) &&
        parsed.getMonth() === Number(month) - 1 &&
        parsed.getDate() === Number(day)
    );
}

/**
 * Reads an ISO date into a `Date` at local noon.
 *
 * Noon rather than midnight because nothing here cares about the time of day, and
 * midnight sits close enough to the boundary that a timezone offset or a daylight
 * saving transition can push it onto the day before or after.
 *
 * @param date A calendar date in ISO format (yyyy-mm-dd).
 * @returns The `Date` at noon local time on that day.
 * @throws If the string is not a real ISO calendar date.
 */
export function parseIsoDate(date: IsoDate): Date {
    if (!isValidIsoDate(date)) {
        throw new Error(`Not a calendar date in ISO format (yyyy-mm-dd): ${JSON.stringify(date)}`);
    }
    const [, year, month, day] = date.match(ISO_DATE_PATTERN)!;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
}

/**
 * The date a given number of days after (or, for a negative offset, before) another.
 *
 * @param date A calendar date in ISO format (yyyy-mm-dd).
 * @param days How many days to move, which may be negative or zero.
 * @returns The resulting date in ISO format.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
    const moved = parseIsoDate(date);
    moved.setDate(moved.getDate() + days);
    return isoDate(moved);
}

/**
 * The weekday a date falls on, e.g. "Saturday".
 *
 * @param date A calendar date in ISO format (yyyy-mm-dd).
 * @returns The English name of the weekday.
 */
export function weekdayOf(date: IsoDate): string {
    return WEEKDAY_NAMES[parseIsoDate(date).getDay()]!;
}

/**
 * A date range as it reads on a page: "September 24–27, 2026".
 *
 * Collapses whatever the two dates have in common — a one-day event names its day
 * once, a range within a month names the month once, and a range within a year
 * names the year once.
 *
 * @param startDate The first day, in ISO format (yyyy-mm-dd).
 * @param endDate The last day, in ISO format (yyyy-mm-dd).
 * @returns The range rendered for display.
 */
export function formatDateRange(startDate: IsoDate, endDate: IsoDate): string {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    const startMonth = MONTH_NAMES[start.getMonth()];
    const endMonth = MONTH_NAMES[end.getMonth()];

    if (startDate === endDate) {
        return `${startMonth} ${start.getDate()}, ${start.getFullYear()}`;
    }
    if (start.getFullYear() !== end.getFullYear()) {
        // A range that crosses New Year has to name both years.
        return `${startMonth} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
    }
    if (start.getMonth() !== end.getMonth()) {
        return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
    }
    // Tight en dash between two days of the same month, spaced one between months.
    return `${startMonth} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
}

/**
 * An event's dates as they read on a page: "September 24–27, 2026".
 *
 * @param event Anything carrying an event's timing, which in practice is an `Event`.
 * @returns The event's date range rendered for display.
 */
export function formatEventDates(event: { timing: { start: IsoDate; end: IsoDate } }): string {
    return formatDateRange(event.timing.start, event.timing.end);
}

/**
 * Comparison/sorting function for ISO dates (yyyy-mm-dd), oldest first.
 *
 * ISO dates sort correctly as plain strings; this exists for the `undefined`
 * handling, which sorts a missing date last either way round.
 *
 * @param a First date to compare.
 * @param b Second date to compare.
 * @returns A negative number if `a` is before `b`, a positive number if `a` is after `b`, or 0 if they are the same.
 */
export const compareIsoDates = (a: IsoDate|undefined, b: IsoDate|undefined): number => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
};
