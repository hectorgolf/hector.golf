import { writeFileSync, existsSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { playersData, hectorEvents, hasParticipants, isUpcomingEvent, isPastEvent } from "../code/data.ts";
import { getAllPlayers, getPlayerName, updatePlayerData } from "../code/players.ts";
import { type Player } from "../schemas/players.ts";
import { type HectorEvent } from "../schemas/events.ts";

import { createTeetimeSession } from "../code/handicaps/teetime-api";
import { createWisegolfSession } from "../code/handicaps/wisegolf-api";
import { type GolfClub, type HandicapSource } from "../code/handicaps/handicap-source-api";
import { parseEventDateRange } from "../code/dates.ts";
import { formatForPrinting } from "../code/strings.ts";

const ENV = import.meta.env || process.env || {};
const apiKeyForBackendFunctions = ENV.ASTROSITE_API_KEY;
const DEBUG_GENAI_BIOGRAPHY = !!ENV.DEBUG_GENAI_BIOGRAPHY;

// Get the resolved path to this file and determine the directory from that
// (__dirname is not available in ES6 modules)
const __filename = fileURLToPath(import.meta.url);
const pathToCommitMessage = join(dirname(__filename), "../../.update-player-biographies-commit");

function createHandicapSources(): Promise<HandicapSource[]> {
    return Promise.all([createWisegolfSession(), createTeetimeSession()]);
}

function mergeClubs(instances: GolfClub[]): GolfClub {
    if (instances.length === 0) {
        throw new Error("mergeClubs() was called with an empty array.");
    }
    if (instances.length === 1) {
        return instances[0];
    }
    const sources = instances.map((i) => i.sources).flat();
    // When multiple sources have the same club, prefer the one from WiseGolf as their names are generally better spelled.
    const clubFromWiseGolf = instances.find((i) => i.sources.map((s) => s.name).includes("WiseGolf"));
    if (clubFromWiseGolf) {
        return { ...clubFromWiseGolf, sources };
    } else {
        return { ...instances[0], sources };
    }
}

const golfClubs: Promise<GolfClub[]> = (async () => {
    const sources = await createHandicapSources();
    const clubs = (await Promise.all(sources.map((s) => s.getClubs()))).flat();
    const sorted = clubs.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
    const merged = sorted
        .map((c) => c.abbreviation)
        .filter((abbr, index, self) => self.indexOf(abbr) === index)
        .map((abbr) => mergeClubs(clubs.filter((c) => c.abbreviation === abbr)));
    writeFileSync(join(dirname(__filename), "../../src/data/clubs.json"), JSON.stringify(merged, null, 2));
    return merged;
})();

const getPlayerById = (id: string): Player | undefined => {
    let record = playersData.find((record) => record.id === id) as Player;
    if (!record) {
        return undefined;
    }
    return record;
};

async function getClubName(clubAbbreviation: string | undefined): Promise<string> {
    if (!clubAbbreviation) {
        return "unknown";
    }
    const club = (await golfClubs).find((c) => c.abbreviation === clubAbbreviation);
    return club?.name || "unknown";
}

if (existsSync(pathToCommitMessage)) {
    console.log(`Deleting pre-existing commit message file: ${resolve(pathToCommitMessage)}`);
    rmSync(pathToCommitMessage, { force: true });
} else {
    console.log(`Creating an empty commit message file: ${resolve(pathToCommitMessage)}`);
}
writeFileSync(pathToCommitMessage, "");

type EventNameAndYear = {
    name: string;
    year: number;
};

type NextEvent = EventNameAndYear & {
    participates: boolean;
};

type PlayerBiographyInput = {
    name: string;
    gender: "male" | "female";
    homeClub: string;
    miscellaneousDetails: string[];
    previousAppearances: EventNameAndYear[];
    hectorWins: EventNameAndYear[];
    victorWins: EventNameAndYear[];
    allPastEvents: EventNameAndYear[];
    nextEvent: NextEvent | undefined;
    retired: boolean;
};

function EventNameAndYearFrom(event: { name: string; date: string }): EventNameAndYear {
    const range = parseEventDateRange(event.date)
    return {
        name: event.name,
        year: range?.endDate.getFullYear() || range?.startDate.getFullYear() || 0,
    };
}

function describeEvent(event: { name: string; date: string }): string {
    return `${event.name} (${parseEventDateRange(event.date)?.startDate.getFullYear()})`;
}

function describePlayer(player: Player): string {
    return getPlayerName(player);
}

function playerParticipatedInEvent(player: Player, event: HectorEvent): boolean {
    return (
        event.participants.includes(player.id) ||
        event.results?.winners?.hector?.includes(player.id) ||
        event.results?.winners?.victor?.includes(player.id) ||
        false
    );
}

async function extractPlayerBiographyInput(player: Player): Promise<PlayerBiographyInput> {
    const allPastEvents = hectorEvents.filter(isPastEvent);
    const pastAppearances = allPastEvents.filter((e) => playerParticipatedInEvent(player, e));
    const lastAppearance = pastAppearances[0];
    const eventsSinceLastAppearance = lastAppearance ? hectorEvents.indexOf(lastAppearance) : hectorEvents.length;

    if (DEBUG_GENAI_BIOGRAPHY) {
        console.log(`${describePlayer(player)}: ${eventsSinceLastAppearance} events since last appearance in Hector.`);
    
        console.log(`${allPastEvents.length} past events in total:`);
        for (const event of allPastEvents) {
            console.log(`- ${describeEvent(event)}`);
        }
        console.log(`${pastAppearances.length} past appearances for ${describePlayer(player)}:`);
        for (const event of pastAppearances) {
            console.log(`- ${describeEvent(event)}`);
        }
        console.log(
            `Last appearances for ${describePlayer(player)} was ${lastAppearance ? describeEvent(lastAppearance) : "(none)"}`
        );
    }

    // const lastAppearanceYear = parseEventDateRange(lastAppearance.date)?.endDate.getFullYear();
    const nextHectorEvent = hectorEvents.filter(isUpcomingEvent).filter(hasParticipants)[0];
    return {
        name: player.name.first,
        gender: player.gender || "male",
        homeClub: await getClubName(player.club),
        previousAppearances: pastAppearances.map(EventNameAndYearFrom),
        hectorWins: hectorEvents
            .filter((e) => e.results?.winners?.hector?.includes(player.id))
            .map(EventNameAndYearFrom),
        victorWins: hectorEvents
            .filter((e) => e.results?.winners?.victor?.includes(player.id))
            .map(EventNameAndYearFrom),
        miscellaneousDetails: player.misc || [],
        allPastEvents: hectorEvents.filter(isPastEvent).map(EventNameAndYearFrom),
        nextEvent: nextHectorEvent
            ? {
                  ...EventNameAndYearFrom(nextHectorEvent),
                  participates: nextHectorEvent?.participants.includes(player.id),
              }
            : undefined,
        retired: eventsSinceLastAppearance > 7,
    };
}

async function generateBiography(input: PlayerBiographyInput): Promise<string[]> {
    const response = await fetch(
        "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerBiography",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKeyForBackendFunctions}`,
            },
            body: JSON.stringify(input),
        }
    );

    if (!response.ok) {
        return Promise.reject(`Failed to generate biography: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (Array.isArray(data.biography)) {
        console.log(`\n<<<<<\nGot biography for ${input.name}:`)
        if (DEBUG_GENAI_BIOGRAPHY) {
            console.log(`\n${JSON.stringify(input, null, 2)}`);
        }
        console.log(`\n=>\n\n${formatForPrinting(data.biography)}\n\n>>>>>\n`);
        return data.biography as string[];
    } else {
        return Promise.reject(
            `Failed to generate biography due to unexpected response from API: ${JSON.stringify(data, null, 2)}`
        );
    }
}

async function updateBiographiesForEvent(event: HectorEvent) {
    getAllPlayers();
    const commitMessage: string[] = [];
    for (const player of getAllPlayers()) {
        const input = await extractPlayerBiographyInput(player);
        const biography = await generateBiography(input);
        const playerName = getPlayerName(player);
        commitMessage.push(playerName);
        console.log(`- Updated biography for ${playerName}`);
        await updatePlayerData({ ...player, biography });
    }
    if (commitMessage.length > 0) {
        writeFileSync(
            pathToCommitMessage,
            `Updated biographies for ${commitMessage.length} players:\n${commitMessage.map((m) => `- ${m}`).join("\n")}`
        );
    }
}

function eventToUpdateBiographiesFor(): HectorEvent | undefined {
    const upcomingEvents = hectorEvents.filter(isUpcomingEvent).filter(hasParticipants);
    return upcomingEvents[0] as HectorEvent | undefined;
}

const run = async () => {
    const event = eventToUpdateBiographiesFor();
    if (event) {
        await updateBiographiesForEvent(event);
    }
    console.log("Done updating player biographies.");
};

console.log("Updating player biographies...");
run();
