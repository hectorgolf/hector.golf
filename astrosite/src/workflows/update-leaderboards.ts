import { resolve } from "path";
import { fileURLToPath } from "url";

import { type HectorEvent } from "@hector/schemas/src/events.ts";
import { addDays, isoDateToday } from "@hector/schemas/src/dates.ts";
import { playersData, eventsData, pathToEventJson, isHectorEvent } from "../code/data.ts";
import { redact } from "../code/strings.ts";
import { fetchHectorLeaderboardData, fetchVictorLeaderboardData } from "../code/leaderboards/google-sheets.ts";
import { updateHectorEventLeaderboard } from "../code/leaderboards/github.ts";
import { splitCompetitorNames } from "@hector/schemas/src/leaderboards/names.ts";
import { writeJsonFile } from "../code/json.ts";
import {
    googleSheetIdFromLeaderboardUrl,
    isAppHectorGolfLeaderboard,
    isGoogleSheetsLeaderboard,
} from "@hector/schemas/src/leaderboards/sources.ts";
import type { GoogleSheetTeamLeaderboard, GoogleSheetIndividualLeaderboard } from "@hector/schemas/src/leaderboards/types.ts";

// This workflow updates the leaderboards for the ongoing Hector events whose
// standings live in a Google Sheet.
//
// It used to do the app.hector.golf ones too. Those moved to the admin service's
// `leaderboards` job on 2026-09-24, because a board that changes with every putt
// wants an update that starts when it is told to, and a GitHub run is dispatched,
// queued, given a runner and made to `npm ci` first. app.hector.golf calls
// `POST /api/jobs/leaderboards/run` instead, and the tick runs the same job.
//
// The split is by source, and both sides enforce it: `skipEventsOwnedByTheAdmin`
// below drops what the job takes. Two writers for one leaderboard file would race
// for it and commit over each other, which is the whole reason this is a hard
// split rather than a fallback.
//
// This constant defines whether to include future (upcoming) events in the
// update or not. If set to false, only events that have already started will
// be updated. If set to true, future events will also be updated.
const updateFutureEvents = false;

type HectorTeam = {
    name: string;
    players: string[];
};

function getPlayerByName(name: string): string | undefined {
    return playersData.find((player: any) => {
        const aliases = [player.name, ...(player.aliases || [])].map((name: any) => {
            if (name.first && name.last) {
                return `${name.first} ${name.last}`;
            }
            return name.toString();
        });
        return aliases.map((n) => n.toLowerCase()).includes(name.toLowerCase());
    })?.id;
}

/**
 * Drops the events the admin service's `leaderboards` job publishes.
 *
 * Said out loud rather than filtered silently: somebody reading this run's log
 * because a board looks stale needs to be told where that board is updated now.
 */
function skipEventsOwnedByTheAdmin(events: Array<HectorEvent>): Array<HectorEvent> {
    return events.filter((e) => {
        if (isAppHectorGolfLeaderboard(e.leaderboardSheet)) {
            console.log(
                `Not updating leaderboards for ${e.name} here: it is managed on app.hector.golf, which the admin ` +
                    `service's 'leaderboards' job publishes.`,
            );
            return false;
        }
        return true;
    });
}

function getOngoingHectorEvents(): Array<HectorEvent> {
    return skipEventsOwnedByTheAdmin(
        (eventsData as Array<HectorEvent>).filter(isHectorEvent).filter((e) => !!e.leaderboardSheet),
    )
        .filter((e) => {
            if (!updateFutureEvents && e.timing.start > isoDateToday()) {
                const title = `Not updating leaderboards for ${e.name} because it's in the future`;
                const subtitle = `the tournament starts on ${e.timing.start} while today is ${isoDateToday()}`;
                console.log(`${title}: ${subtitle}`);
                return false; // event hasn't even started yet
            }

            if (e.timing.end < addDays(isoDateToday(), -1)) {
                const title = `Not updating leaderboards for ${e.name} because it's in the past`;
                const subtitle = `the tournament ended on ${e.timing.end} while today is ${isoDateToday()}`;
                console.log(`${title}: ${subtitle}`);
                return false; // event finished yesterday or earlier
            }

            return true;
        });
}

async function updateLeaderboardsWithData(
    event: HectorEvent,
    hectorLeaderboard: GoogleSheetTeamLeaderboard,
    victorLeaderboard: GoogleSheetIndividualLeaderboard,
): Promise<boolean> {
    // TODO: check if the leaderboards have changed (compared to the file on disk right now) before making a commit

    const githubToken = process.env.GITHUB_ACCESS_TOKEN as string;
    console.log(`Updating leaderboard data for ${event.name} on Github with token ${redact(githubToken)}`);
    const updated = await updateHectorEventLeaderboard(githubToken, event.id, hectorLeaderboard, victorLeaderboard);
    if (updated) {
        console.log(`Updated leaderboard data for ${event.name}`);
    } else {
        console.log(`Did NOT update leaderboard data for ${event.name}`);
    }

    const eventTeams = event.results?.teams || [];
    if (eventTeams.length === 0) {
        // src/data/events/{format}/{id}.json does not yet have teams for this event
        const leaderboardHasPairings = hectorLeaderboard.every((team) => team.team && team.team.trim().length > 0);
        if (leaderboardHasPairings) {
            console.log(
                `The Hector leaderboard for ${event.name} has pairings, so we'll use them to generate the teams`,
            );
            const leaderboardTeams = hectorLeaderboard.map((team) => {
                return {
                    name: team.team,
                    players: splitCompetitorNames(team.team).map((name) => getPlayerByName(name)),
                };
            });
            const rawEvent = eventsData.find((e) => e.id === event.id);
            if (rawEvent && isHectorEvent(rawEvent)) {
                if (leaderboardTeams.every((team) => team.players.every((p) => !!p))) {
                    const winners = rawEvent.results?.winners || { hector: [], victor: [] };
                    rawEvent.results = { teams: leaderboardTeams as Array<HectorTeam>, winners };
                    console.log(`Added ${leaderboardTeams.length} teams for ${event.name} from live leaderboard data`);
                    const filePath = pathToEventJson(rawEvent);
                    writeJsonFile(filePath, rawEvent);
                    console.log(`Updated team pairings in ${filePath}`);
                    return true;
                }
            }
        } else {
            console.log(
                `The Hector leaderboard for ${event.name} does not have pairings yet, so we can't generate the teams: ${JSON.stringify(hectorLeaderboard, null, 2)}`,
            );
        }
    } else {
        console.log(
            `The event ${event.name} already has ${eventTeams.length} teams, so we won't generate them from the leaderboard`,
        );
    }
    return false;
}

async function updateLeaderboardsForAllOngoingTournaments(): Promise<void> {
    const events = getOngoingHectorEvents();

    let eventsUpdated = 0;
    console.log(
        `Found ${events.length} ongoing Hector events with a live leaderboard: ${events.map((e) => e.name).join(", ")}`,
    );
    for (const event of events) {
        console.log(`Updating leaderboard for ${event.name}...`);
        let hectorLeaderboard: GoogleSheetTeamLeaderboard | undefined;
        let victorLeaderboard: GoogleSheetIndividualLeaderboard | undefined;

        if (isGoogleSheetsLeaderboard(event.leaderboardSheet)) {
            console.log(`${event.name} seems to be managed on Google Sheets`);
            const leaderboardSheetId = googleSheetIdFromLeaderboardUrl(event.leaderboardSheet);
            console.log(`Leaderboard sheet URL: ${event.leaderboardSheet}`);
            console.log(`Leaderboard sheet ID:  ${leaderboardSheetId}`);
            if (leaderboardSheetId) {
                console.log(`Fetching leaderboard data for ${event.name} from the Google Sheet`);
                hectorLeaderboard = await fetchHectorLeaderboardData(leaderboardSheetId);
                victorLeaderboard = await fetchVictorLeaderboardData(leaderboardSheetId);
            }
        } else if (event.leaderboardSheet) {
            // If the URL is defined but doesn't match any of the known patterns,
            // log an error so that we'll see what URL is causing problems.
            console.error(`Don't know how to fetch leaderboard data for ${event.name} from ${event.leaderboardSheet}`);
        }

        if (hectorLeaderboard && victorLeaderboard) {
            const updated = await updateLeaderboardsWithData(event, hectorLeaderboard, victorLeaderboard);
            if (updated) {
                eventsUpdated += 1;
            }
        }
    }

    console.log(`Updated leaderboards for ${eventsUpdated} out of ${events.length} ongoing Hector events.`);
}

// Get the resolved path to this file and determine the directory from that
// (__dirname is not available in ES6 modules)
const __filename = fileURLToPath(import.meta.url);

// Only when this file is the thing being run, as in `update-handicaps.ts`. Nothing
// imports this module today, but the sweep below writes team pairings into the
// committed event JSON and pushes a leaderboard commit to GitHub, so the first
// import that ever wants one of the functions above would have done all of that
// first — and the tests are the likeliest first importer.
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
    updateLeaderboardsForAllOngoingTournaments();
}
