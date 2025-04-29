// TODO: convert these types to objects with additional properties such as the scoring system used (points vs strokes)

/**
 * The individual leaderboard is a list of players, each with a player name, points, diff, and through.
 * 
 * The diff is the difference between the player's points and the previous player's points expressed as
 * either "+3.5" or "-1.5" depending on the scoring system used.
 * 
 * The "through" is a string formatted as "X/Y" indicating "X rounds played out of Y". If the player
 * has played all rounds, the through is "Y/Y".
 */
export type GoogleSheetIndividualLeaderboard = Array<{ player: string, points: number, diff: string, through: string }>

/**
 * The team leaderboard is a list of teams, each with a team name, points, diff, and through.
 * 
 * The diff is the difference between the team's points and the previous team's points expressed as
 * either "+3.5" or "-1.5" depending on the scoring system used.
 * 
 * The "through" is a string formatted as "X/Y" indicating "X rounds played out of Y". If the team
 * has played all rounds, the through is "Y/Y".
 */
export type GoogleSheetTeamLeaderboard = Array<{ team: string, points: number, diff: string, through: string }>
