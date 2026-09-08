import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from "./types";

/**
 * The parts of an app.hector.golf tournament payload that the leaderboards read.
 *
 * Deliberately structural rather than a zod schema. This module is imported by the
 * browser-side live leaderboard as well as by the build, and pulling zod into the
 * client bundle to re-validate a payload that only feeds a table would cost more
 * than it buys: a malformed payload in the browser means "no live update", and the
 * statically rendered table is still standing behind it.
 *
 * The strict schema lives in `app.ts`, on the path where a malformed payload could
 * be written to disk and published. Both paths share the extractors below, so the
 * field mapping — the part that can actually drift from upstream — is defined once.
 */
export type AppTeamEntry = {
    players: string;
    points: number;
    diffToLeader?: number | null;
    roundsPlayed: number;
};

export type AppPlayerEntry = {
    player: string;
    points: number;
    diffToLeader?: number | null;
    roundsPlayed: number;
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

export const extractHectorRows = (data: AppLeaderboardPayload): GoogleSheetTeamLeaderboard => {
    return data.hector.map((entry) => ({
        team: entry.players,
        points: entry.points,
        diff: entry.diffToLeader ? String(entry.diffToLeader) : "",
        through: `${entry.roundsPlayed}/${data.rounds.length}`,
    }));
};

export const extractVictorRows = (data: AppLeaderboardPayload): GoogleSheetIndividualLeaderboard => {
    return data.victor.map((entry) => ({
        player: entry.player,
        points: entry.points,
        diff: entry.diffToLeader ? String(entry.diffToLeader) : "",
        through: `${entry.roundsPlayed}/${data.rounds.length}`,
    }));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasEntryShape = (value: unknown, nameField: "players" | "player"): boolean => {
    if (!isRecord(value)) return false;
    const diff = value.diffToLeader;
    return (
        typeof value[nameField] === "string" &&
        typeof value.points === "number" &&
        typeof value.roundsPlayed === "number" &&
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
