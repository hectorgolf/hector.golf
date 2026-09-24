/**
 * Presentation helpers shared by the statically rendered leaderboard and the
 * browser-side live one.
 *
 * Kept apart from `leaderboards.ts` because that module reads the data files at
 * import time and would drag `fs` into the client bundle. Everything here is pure.
 */

/** A row as far as positioning is concerned: only the score matters. */
type Scored = { points: number | string };

const asNumber = (points: number | string): number => {
    return typeof points === "number" ? points : parseFloat(points);
};

/**
 * The position to print for a score, as "3" or "T3" when it is shared.
 *
 * Ties are detected on the raw value rather than the parsed one so that two rows
 * both reading "222.0" tie even if a future source starts sending "222".
 */
export function leaderboardPosition(
    leaderboard: ReadonlyArray<Scored>,
    points: number | string,
    lowerIsBetter: boolean,
): string {
    const score = asNumber(points);
    const numberOfBetterScores = leaderboard.filter(({ points: other }) => {
        const value = asNumber(other);
        return lowerIsBetter ? value < score : value > score;
    }).length;
    const numberOfEqualScores = leaderboard.filter(({ points: other }) => other === points).length;
    if (numberOfEqualScores > 1) {
        return `T${numberOfBetterScores + 1}`;
    }
    return `${numberOfBetterScores + 1}`;
}

/**
 * How many decimals a board's numbers carry.
 *
 * This follows the unit the board counts in, and the scoring direction is how
 * that unit is recorded: a board where lower is better is counting **strokes**,
 * which are fractional once handicap allowances are applied — 224.9 is a real
 * score — while a board where higher is better is counting **Stableford points**,
 * and there is no such thing as half a Stableford point.
 *
 * Reading it off the direction rather than off the competition's name is what
 * keeps the older events right. Hector counted points until 2022 and strokes
 * from 2023, so HECTOR2020 is a Hector board that must print "206" while
 * HECTOR2025 is a Hector board that must print "222.0". The stored `scoring`
 * field already says which each one is.
 */
export function decimalsForBoard(lowerIsBetter: boolean): number {
    return lowerIsBetter ? 1 : 0;
}

/**
 * The difference to the leader, as the board prints it.
 *
 * The leader's own row and a dead-level row both print nothing — a column of
 * "0.0" against the leader reads as a score rather than as a gap.
 *
 * The sign is preserved and the magnitude re-formatted to the board's precision,
 * rather than the source string being passed through with a decimal bolted on.
 * The sources disagree about precision for the same competition — a sheet has
 * sent Victor gaps as both "-2" and "-2.0" in different years — and the column
 * has to read the same way down its whole length regardless.
 */
export function normalizeDiff(diff: string, decimals: number): string {
    if (diff === "") return diff;
    const value = parseFloat(diff);
    // Anything that is not a number is handed back untouched: a source that
    // starts sending "E" or "AS" for level should reach the board as it wrote it
    // rather than as "NaN".
    if (!Number.isFinite(value)) return diff;
    if (value === 0) return "";
    return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(decimals)}`;
}

/**
 * How far through the rounds, as the board prints it: "F" once every round is in.
 */
export function throughLabel(through: string): string {
    if (through && /^\d+\/\d+$/.test(through)) {
        const [played, total] = through.split("/");
        if (played === total) return "F";
    }
    return through || "0";
}

/**
 * The score, as the board prints it, at the board's own precision.
 *
 * A stored score is a *string* — the sheets write "143.0" one year and "150" the
 * next for the same competition — so it is parsed and re-formatted rather than
 * passed through. Passing it through is what made the Victor board print "150"
 * for 2023 and "143.0" for 2025, which is the same score in two notations.
 *
 * Something that will not parse is handed back as it arrived, for the same
 * reason as in `normalizeDiff`.
 */
export function pointsLabel(points: number | string, decimals: number): string {
    const value = asNumber(points);
    return Number.isFinite(value) ? value.toFixed(decimals) : String(points);
}

/**
 * A timestamp as the live board prints it: the time of day, in the reader's own
 * formatting.
 *
 * No date, because a board is read while it is being played and "18:37" is what
 * a reader wants from it. What keeps that honest is `agoLabel` below: standings
 * old enough for the date to matter are printed with their age beside them.
 */
export function clockLabel(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * How long ago something was, in the roundest words still true of it.
 *
 * Rounded down throughout, so the board never claims to be further behind than
 * it is. It goes up to days because it has to: a cached board may be two days
 * old, and the poller keeps running for a day after the event's last round.
 */
export function agoLabel(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "a day ago" : `${days} days ago`;
}
