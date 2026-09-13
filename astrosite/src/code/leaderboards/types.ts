/**
 * Which way a board's scores run.
 *
 * `ascending` means a lower score is better, which is Hector from 2023 onwards:
 * it counts strokes. `descending` means a higher score is better, which is
 * Victor: it counts Stableford points. Hector counted points before 2023, so the
 * stored files for HECTOR2020–2022 say `descending` for that board and the
 * direction is genuinely per event rather than per competition.
 */
export type ScoringDirection = "ascending" | "descending";

/**
 * The directions a board written today runs in.
 *
 * One definition, because three places used to state it separately: the writer
 * in `github.ts` stamps it into every leaderboard file, the leaderboard page
 * falls back to it for the older files that predate the field, and the app
 * adapter needs it to know which way a gap to the leader points. Those three
 * agreeing is not optional — a disagreement would render every diff on the board
 * with the wrong sign — so they now read it from here rather than each other.
 */
export const BOARD_SCORING: { readonly hector: ScoringDirection; readonly victor: ScoringDirection } = {
    hector: "ascending",
    victor: "descending",
};

/**
 * The individual leaderboard is a list of players, each with a player name, points, diff, and through.
 *
 * The diff is the player's score minus the leader's, as a string carrying its own
 * sign: "+3.5" where the leader is ahead on a board counting strokes, "-1.5"
 * where the leader is ahead on one counting points. An empty string means there
 * is no gap to show — the leader's own row, or a dead-level one.
 *
 * The "through" is a string formatted as "X/Y" indicating "X rounds played out of Y". If the player
 * has played all rounds, the through is "Y/Y".
 */
export type GoogleSheetIndividualLeaderboard = Array<{ player: string; points: number; diff: string; through: string }>;

/**
 * The team leaderboard is a list of teams, each with a team name, points, diff, and through.
 *
 * The diff carries its own sign, exactly as for the individual board above.
 *
 * The "through" is a string formatted as "X/Y" indicating "X rounds played out of Y". If the team
 * has played all rounds, the through is "Y/Y".
 */
export type GoogleSheetTeamLeaderboard = Array<{ team: string; points: number; diff: string; through: string }>;
