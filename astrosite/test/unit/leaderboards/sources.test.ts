import { describe, expect, it } from "vitest";

import {
    appEventIdFromLeaderboardUrl,
    googleSheetIdFromLeaderboardUrl,
    isAppHectorGolfLeaderboard,
    isGoogleSheetsLeaderboard,
} from "../../../src/code/leaderboards/sources.ts";

const APP_URL = "https://app.hector.golf/api/tournament?event=HECTOR2026";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1QBmokR7_ir0l36B1hLZCYIPTeUbLG2V4RiLSL2QVOts/edit";

describe("recognising a leaderboard source", () => {
    it("recognises app.hector.golf", () => {
        expect(isAppHectorGolfLeaderboard(APP_URL)).toBe(true);
        expect(isGoogleSheetsLeaderboard(APP_URL)).toBe(false);
    });

    it("recognises Google Sheets", () => {
        expect(isGoogleSheetsLeaderboard(SHEET_URL)).toBe(true);
        expect(isAppHectorGolfLeaderboard(SHEET_URL)).toBe(false);
    });

    it("treats a missing URL as neither", () => {
        expect(isAppHectorGolfLeaderboard(undefined)).toBe(false);
        expect(isGoogleSheetsLeaderboard(undefined)).toBe(false);
    });

    it("does not mistake a lookalike host for app.hector.golf", () => {
        // The proxy trusts this predicate, so a near-miss must not pass.
        expect(isAppHectorGolfLeaderboard("https://app.hector.golf.evil.example/api/tournament")).toBe(false);
        expect(isAppHectorGolfLeaderboard("http://app.hector.golf/api/tournament")).toBe(false);
    });
});

describe("extracting the app event id", () => {
    it("reads the event parameter", () => {
        expect(appEventIdFromLeaderboardUrl(APP_URL)).toBe("HECTOR2026");
    });

    it("is undefined when the parameter is missing", () => {
        expect(appEventIdFromLeaderboardUrl("https://app.hector.golf/api/tournament")).toBeUndefined();
    });

    it("is undefined for a source that cannot be polled", () => {
        expect(appEventIdFromLeaderboardUrl(SHEET_URL)).toBeUndefined();
    });

    it("rejects an id that could not be a tournament", () => {
        expect(appEventIdFromLeaderboardUrl("https://app.hector.golf/api/tournament?event=../secrets")).toBeUndefined();
        expect(appEventIdFromLeaderboardUrl("https://app.hector.golf/api/tournament?event=a b")).toBeUndefined();
        expect(appEventIdFromLeaderboardUrl("https://app.hector.golf/api/tournament?event=")).toBeUndefined();
    });
});

describe("extracting the Google Sheet id", () => {
    it("reads the id out of an edit URL", () => {
        expect(googleSheetIdFromLeaderboardUrl(SHEET_URL)).toBe("1QBmokR7_ir0l36B1hLZCYIPTeUbLG2V4RiLSL2QVOts");
    });

    it("is undefined for a source that is not a sheet", () => {
        expect(googleSheetIdFromLeaderboardUrl(APP_URL)).toBeUndefined();
    });
});
