/**
 * Reading a date and time off the terminal.
 *
 * Kept apart and pure so the parsing can be tested: a round's date is one of the
 * few things a typo would quietly get wrong rather than loudly reject.
 */

/** `YYYY-MM-DD HH:MM`, `YYYY-MM-DD`, or `HH:MM` for a time on a given day. */
const FULL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

/**
 * Parses what someone typed into a local date and time.
 *
 * Local, not UTC: the API stores the wall-clock time at the course, so 17:10 in
 * Helsinki is written as 17:10 whatever the machine's offset. Returns undefined for
 * anything it cannot read, including a date that does not exist.
 */
export function parseWhen(input: string, on: Date = new Date()): Date | undefined {
    const text = input.trim();

    const full = FULL.exec(text);
    if (full) return build(+full[1]!, +full[2]!, +full[3]!, +full[4]!, +full[5]!);

    const day = DAY.exec(text);
    if (day) return build(+day[1]!, +day[2]!, +day[3]!, 0, 0);

    const time = TIME.exec(text);
    if (time) return build(on.getFullYear(), on.getMonth() + 1, on.getDate(), +time[1]!, +time[2]!);

    return undefined;
}

/** Builds a local date, rejecting one that rolled over — 31 February and the like. */
function build(year: number, month: number, day: number, hour: number, minute: number): Date | undefined {
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    const survived =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day &&
        date.getHours() === hour &&
        date.getMinutes() === minute;
    return survived ? date : undefined;
}

/** How a date is shown back, in the same form `parseWhen` accepts. */
export function formatWhen(date: Date): string {
    const pad = (value: number) => `${value}`.padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

/** Turns the API's `YYYYMMDDHHmm` back into a local date. */
export function parseRoundDate(stored: string): Date | undefined {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stored);
    return match ? build(+match[1]!, +match[2]!, +match[3]!, +match[4]!, +match[5]!) : undefined;
}
