/**
 * ID minting.
 *
 * mScorecard expects the *client* to invent both round IDs and roster player IDs,
 * so uniqueness is our problem. Both are wall-clock based, matching what the app
 * does: a round ID is `Date.now()`, and a player ID is `Date.now()` with three
 * extra digits (`1618037712778955`, `1788645892735896`, …).
 */

export type Clock = () => number;

const defaultClock: Clock = () => Date.now();

/** Mint a round ID: milliseconds since the epoch, as a string. */
export function newRoundID(now: Clock = defaultClock): string {
    return `${now()}`;
}

/** Mint a roster player ID: milliseconds since the epoch plus three random digits. */
export function newPlayerID(now: Clock = defaultClock, random: () => number = Math.random): string {
    const suffix = Math.floor(random() * 1000)
        .toString()
        .padStart(3, "0");
    return `${now()}${suffix}`;
}

/** The wire format for a round's date: "YYYYMMDDHHmm", in local time. */
export function formatRoundDate(date: Date): string {
    const pad = (value: number) => `${value}`.padStart(2, "0");
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
    ].join("");
}
