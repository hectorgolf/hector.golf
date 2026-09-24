import {
    BOARD_SCORING,
    type GoogleSheetIndividualLeaderboard,
    type GoogleSheetTeamLeaderboard,
    type ScoringDirection,
} from "./types.ts";

/**
 * The parts of an app.hector.golf tournament payload that the leaderboards read.
 *
 * Deliberately structural rather than a zod schema. This module is imported by the
 * browser-side live leaderboard as well as by the build, and pulling zod into the
 * client bundle to re-validate a payload that only feeds a table would cost more
 * than it buys: a malformed payload in the browser means "no live update", and the
 * statically rendered table is still standing behind it.
 *
 * The strict schema is `app-response.ts` beside this, on the paths where a
 * malformed payload could be written to disk and published. Both paths share the
 * extractors below, so the field mapping — the part that can actually drift from
 * upstream — is defined once.
 */
export type AppTeamEntry = {
    players: string;
    points?: number;
    diffToLeader?: number | null;
    roundsPlayed?: number;
};

export type AppPlayerEntry = {
    player: string;
    points?: number;
    diffToLeader?: number | null;
    roundsPlayed?: number;
};

export type AppLeaderboardPayload = {
    rounds: ReadonlyArray<unknown>;
    hector: ReadonlyArray<AppTeamEntry>;
    victor: ReadonlyArray<AppPlayerEntry>;
};

export type LeaderboardData = {
    hector: GoogleSheetTeamLeaderboard;
    victor: GoogleSheetIndividualLeaderboard;
};

/** A reading of the payload, plus the two fields that describe the reading itself. */
export type AppLeaderboardSnapshot = LeaderboardData & {
    /** When the upstream says it generated the payload, as an ISO 8601 string. */
    generatedAt?: string;
    /** "upcoming" | "live" | "final" upstream; kept loose because we only compare it. */
    status?: string;
};

/**
 * The gap to the leader, as the shared row shape defines it: signed.
 *
 * app.hector.golf sends `diffToLeader` as a **magnitude** — how far behind, never
 * which way — so 3.5 strokes behind and 3 points behind both arrive as a bare
 * positive number. Google Sheets has always sent the sign along with the number,
 * and the board renders whatever string it is given, so app-sourced rows used to
 * print "3.5" where sheet-sourced rows print "+3.5".
 *
 * The sign is a property of the board's direction rather than of the competition:
 * a player behind the leader scores *higher* where lower is better, and *lower*
 * where higher is better. Hector counted points before 2023, so hard-coding
 * "Hector means plus" would have been wrong for the events that are still
 * published.
 *
 * `Math.abs` first, so that this stays right if upstream ever starts sending the
 * sign itself: a signed value is re-signed to the same thing rather than coming
 * out as "+-3".
 */
const signedDiff = (diffToLeader: number | null | undefined, direction: ScoringDirection): string => {
    // Zero is not "level with the leader by 0", it is a row with no gap to show,
    // and the board prints nothing for it — see `normalizeDiff`, which reduces a
    // sheet's "0.0" to the same empty string.
    if (!diffToLeader) return "";
    const magnitude = Math.abs(diffToLeader);
    return direction === "ascending" ? `+${magnitude}` : `-${magnitude}`;
};

export const extractHectorRows = (data: AppLeaderboardPayload): GoogleSheetTeamLeaderboard => {
    return data.hector.map((entry) => ({
        team: entry.players,
        points: entry.points ?? 0,
        diff: signedDiff(entry.diffToLeader, BOARD_SCORING.hector),
        through: `${entry.roundsPlayed ?? 0}/${data.rounds.length}`,
    }));
};

export const extractVictorRows = (data: AppLeaderboardPayload): GoogleSheetIndividualLeaderboard => {
    return data.victor.map((entry) => ({
        player: entry.player,
        points: entry.points ?? 0,
        diff: signedDiff(entry.diffToLeader, BOARD_SCORING.victor),
        through: `${entry.roundsPlayed ?? 0}/${data.rounds.length}`,
    }));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasEntryShape = (value: unknown, nameField: "players" | "player"): boolean => {
    if (!isRecord(value)) return false;
    const diff = value.diffToLeader;
    const points = value.points;
    const roundsPlayed = value.roundsPlayed;
    return (
        typeof value[nameField] === "string" &&
        (points === undefined || typeof points === "number") &&
        (roundsPlayed === undefined || typeof roundsPlayed === "number") &&
        (diff === undefined || diff === null || typeof diff === "number")
    );
};

const hasPayloadShape = (json: unknown): json is AppLeaderboardPayload & Record<string, unknown> => {
    if (!isRecord(json)) return false;
    return (
        Array.isArray(json.rounds) &&
        Array.isArray(json.hector) &&
        Array.isArray(json.victor) &&
        json.hector.every((entry) => hasEntryShape(entry, "players")) &&
        json.victor.every((entry) => hasEntryShape(entry, "player"))
    );
};

/**
 * Reads a tournament payload without validating anything we do not use.
 *
 * Returns `undefined` rather than throwing or half-reading: the caller's fallback
 * is to leave the existing leaderboard alone, which is the right move for both a
 * network blip and an upstream that changed shape.
 */
export const readAppLeaderboardPayload = (json: unknown): AppLeaderboardSnapshot | undefined => {
    if (!hasPayloadShape(json)) return undefined;
    return {
        hector: extractHectorRows(json),
        victor: extractVictorRows(json),
        generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
        status: typeof json.status === "string" ? json.status : undefined,
    };
};
