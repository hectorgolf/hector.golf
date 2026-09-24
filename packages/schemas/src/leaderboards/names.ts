/**
 * Splits a competitor label into the individual names it names.
 *
 * Google Sheets writes a pair as "A + B"; app.hector.golf writes "A & B". Both
 * separators are accepted so that a pair is linked to its players' pages whichever
 * source the standings came from.
 *
 * Shared rather than a presentation helper, because the same split decides
 * something that is not presentation at all: a leaderboard row is how an event's
 * pairings are first learnt, and `results.teams` is written from these names.
 */
export function splitCompetitorNames(competitor: string): string[] {
    return competitor
        .split(/\s*[+&]\s*/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}
