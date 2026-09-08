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
 * The difference to the leader, as the board prints it.
 *
 * The leader's own row and a dead-level row both print nothing — a column of
 * "0.0" against the leader reads as a score rather than as a gap.
 */
export function normalizeDiff(diff: string): string {
    if (diff === "") return diff;
    if (diff === "0.0") return "";
    return diff.includes(".") ? diff : `${diff}.0`;
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

/** The score, as the board prints it: one decimal, matching the stored snapshots. */
export function pointsLabel(points: number | string): string {
    if (typeof points === "string") return points;
    return Number.isFinite(points) ? points.toFixed(1) : String(points);
}

/**
 * Splits a competitor label into the individual names it names.
 *
 * Google Sheets writes a pair as "A + B"; app.hector.golf writes "A & B". Both
 * separators are accepted so that a pair is linked to its players' pages whichever
 * source the standings came from.
 */
export function splitCompetitorNames(competitor: string): string[] {
    return competitor
        .split(/\s*[+&]\s*/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}
