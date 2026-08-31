import { writeFileSync } from "fs";

import { type HectorEvent } from "../schemas/events.ts";
import { parseEventDateRange, isoDate, isoDateToday } from "../code/dates.ts";
import { playersData, eventsData, pathToEventJson, isHectorEvent } from "../code/data.ts";
import { fetchHectorLeaderboardData, fetchVictorLeaderboardData } from "../code/leaderboards/google-sheets.ts";
import { updateHectorEventLeaderboard } from "../code/leaderboards/github.ts";
import { fetchHectorLeaderboardDataFromApp } from "../code/leaderboards/app.ts";
import type { GoogleSheetTeamLeaderboard, GoogleSheetIndividualLeaderboard } from "../code/leaderboards/types.ts";

// This workflow updates the leaderboards for all ongoing Hector events that
// have a live leaderboard (either on Google Sheets or on app.hector.golf).
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

function getOngoingHectorEvents(): Array<HectorEvent> {
    return (eventsData as Array<HectorEvent>)
        .filter(isHectorEvent)
        .filter((e) => !!e.leaderboardSheet)
        .filter((e) => {
            const { startDate, endDate } = parseEventDateRange(e.date) || {};
            if (!startDate) return false;
            if (!endDate) return false;

            if (!updateFutureEvents && isoDate(startDate) > isoDateToday()) {
                console.log(
                    `Not updating leaderboards for ${e.name} because it's in the future: the tournament's date is ${JSON.stringify(e.date)} while today is ${isoDateToday()}`,
                );
                return false; // event hasn't even started yet
            }

            // if (isoDate(endDate) < isoDate(new Date(new Date().getTime() - 1000 * 60 * 60 * 24))) {
            //     console.log(`Not updating leaderboards for ${e.name} because it's in the past: the tournament's date is ${JSON.stringify(e.date)} while today is ${isoDateToday()}`)
            //     return false // event finished yesterday or earlier
            // }
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
    console.log(`Updating leaderboard data for ${event.name} on Github with token ${githubToken.replace(/./g, "*")}`);
    await updateHectorEventLeaderboard(githubToken, event.id, hectorLeaderboard, victorLeaderboard);
    console.log(`Updated leaderboard data for ${event.name}`);

    const teams = event.results?.teams || [];
    if (teams.length === 0) {
        // src/data/events/{format}/{id}.json does not yet have teams for this event
        const leaderboardHasPairings = hectorLeaderboard.every((team) => team.team && team.team.trim().length > 0);
        if (leaderboardHasPairings) {
            console.log(
                `The Hector leaderboard for ${event.name} has pairings, so we'll use them to generate the teams`,
            );
            const teams = hectorLeaderboard.map((team) => {
                return {
                    name: team.team,
                    players: team.team.split("+").map((name) => getPlayerByName(name.trim())),
                };
            });
            if (teams.every((team) => team.players.every((p) => !!p))) {
                const rawEvent = eventsData.find((e) => e.id === event.id);
                if (rawEvent) {
                    rawEvent.results = { teams: teams as Array<HectorTeam>, winners: { hector: [], victor: [] } };
                    console.log(`Added ${teams.length} teams for ${event.name} from live leaderboard data`);
                    const filePath = pathToEventJson(rawEvent);
                    writeFileSync(filePath, JSON.stringify(rawEvent, null, 4));
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
            `The event ${event.name} already has ${teams.length} teams, so we won't generate them from the leaderboard`,
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

        if (event.leaderboardSheet?.match(/^https:\/\/app.hector.golf\//)) {
            console.log(`${event.name} seems to be managed on app.hector.golf`);
            const { hector, victor } = await fetchHectorLeaderboardDataFromApp(event.leaderboardSheet);
            hectorLeaderboard = hector;
            victorLeaderboard = victor;
        } else if (event.leaderboardSheet?.match(/https?:\/\/docs\.google\.com\/spreadsheets/)) {
            console.log(`${event.name} seems to be managed on Google Sheets`);
            const leaderboardSheetId = event.leaderboardSheet
                ?.replace(/https?:\/\/docs\.google\.com\/spreadsheets\/d\//, "")
                .replace(/\/.*$/, "");
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

updateLeaderboardsForAllOngoingTournaments();
