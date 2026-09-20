import { writeFileSync, existsSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { hectorEvents, hasParticipants, isUpcomingEvent, isPastEvent } from "../code/data.ts";
import { getAllPlayers, getPlayerName, updatePlayerData } from "../code/players.ts";
import { type Player } from "@hector/schemas/src/players.ts";
import { biographiesToRegenerate } from "@hector/schemas/src/biographies.ts";
import { type EventTiming, type HectorEvent } from "@hector/schemas/src/events.ts";

import { createWisegolfSession } from "@hector/wisegolf/src/wisegolf-api.ts";
import { type GolfClub, type HandicapSource } from "@hector/wisegolf/src/handicap-source-api.ts";
import { parseIsoDate } from "@hector/schemas/src/dates.ts";
import { formatForPrinting } from "../code/strings.ts";

const ENV = import.meta.env || process.env || {};
const apiKeyForBackendFunctions = ENV.ASTROSITE_API_KEY;
const DEBUG_GENAI_BIOGRAPHY = !!ENV.DEBUG_GENAI_BIOGRAPHY;

// Get the resolved path to this file and determine the directory from that
// (__dirname is not available in ES6 modules)
const __filename = fileURLToPath(import.meta.url);
const pathToCommitMessage = join(dirname(__filename), "../../.update-player-biographies-commit");

function createHandicapSources(): Promise<HandicapSource[]> {
    return Promise.all([createWisegolfSession()]);
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

/**
 * Every club the handicap sources know about, fetched once per process.
 *
 * A function rather than the module-level IIFE this used to be, and the change is
 * not about tidiness. The IIFE meant that *importing* this module scraped WiseGolf
 * and wrote the answer over `src/data/clubs.json`, so a test, a script, or anything
 * else reaching in for one function did a network round trip and rewrote committed
 * data as a side effect of the import statement. Whatever has no credentials — a
 * test run, most obviously — gets nothing back, so what landed in the file was
 * `[]`, in place of 1,402 lines of club data, with nothing failing and nothing said.
 *
 * Memoised, because `getClubName` is called once per player and the club list does
 * not change inside a run. A rejection is memoised too, exactly as the IIFE's
 * rejected promise was: a broken login fails the run rather than being retried once
 * per player.
 */
let clubsFromSources: Promise<GolfClub[]> | undefined;

const golfClubs = (): Promise<GolfClub[]> => {
    clubsFromSources ??= (async () => {
        const sources = await createHandicapSources();
        const clubs = (await Promise.all(sources.map((s) => s.getClubs()))).flat();
        const sorted = clubs.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
        return sorted
            .map((c) => c.abbreviation)
            .filter((abbr, index, self) => self.indexOf(abbr) === index)
            .map((abbr) => mergeClubs(clubs.filter((c) => c.abbreviation === abbr)));
    })();
    return clubsFromSources;
};

async function getClubName(clubAbbreviation: string | undefined): Promise<string> {
    if (!clubAbbreviation) {
        return "unknown";
    }
    const club = (await golfClubs()).find((c) => c.abbreviation === clubAbbreviation);
    return club?.name || "unknown";
}

/*
 * `refreshClubsJson` lived here and now lives in the admin, as the `clubs` job in
 * `admin/src/lib/jobs/clubs.ts`. It was never about biographies — the club list
 * was refreshed here because a run reads it anyway — and leaving it made this
 * workflow a two-output job that could not be retired when the biographies move.
 *
 * The admin's version refreshes at most once every 30 days and records when it
 * asked, inside the file. Both writing here as well would have been a shape war:
 * that one writes `{ fetchedAt, clubs }`, this one wrote a bare array, and each
 * would have seen the other's output as needing a refresh.
 */

/**
 * Start the run's commit message from empty.
 *
 * Inside the run rather than at module scope, for the reason its twin in
 * `update-handicaps.ts` is: an import must not touch the working tree.
 */
const resetCommitMessage = () => {
    if (existsSync(pathToCommitMessage)) {
        console.log(`Deleting pre-existing commit message file: ${resolve(pathToCommitMessage)}`);
        rmSync(pathToCommitMessage, { force: true });
    } else {
        console.log(`Creating an empty commit message file: ${resolve(pathToCommitMessage)}`);
    }
    writeFileSync(pathToCommitMessage, "");
};

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
    otherGeneratedBiographies: string[];
};

function EventNameAndYearFrom(event: { name: string; timing: EventTiming }): EventNameAndYear {
    return {
        name: event.name,
        year: parseIsoDate(event.timing.end).getFullYear(),
    };
}

function describeEvent(event: { name: string; timing: EventTiming }): string {
    return `${event.name} (${parseIsoDate(event.timing.start).getFullYear()})`;
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

async function extractPlayerBiographyInput(
    player: Player,
    otherGeneratedBiographies: string[],
): Promise<PlayerBiographyInput> {
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
            `Last appearances for ${describePlayer(player)} was ${lastAppearance ? describeEvent(lastAppearance) : "(none)"}`,
        );
    }

    // const lastAppearanceYear = parseIsoDate(lastAppearance.timing.end).getFullYear();
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
        otherGeneratedBiographies,
    };
}

async function generateBiography(input: PlayerBiographyInput): Promise<string[]> {
    const response = await fetch(
        "https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerBiography",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKeyForBackendFunctions}`,
            },
            body: JSON.stringify(input),
        },
    );

    if (!response.ok) {
        return Promise.reject(`Failed to generate biography: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (Array.isArray(data.biography)) {
        console.log(`\n<<<<<\nGot biography for ${input.name}:`);
        if (DEBUG_GENAI_BIOGRAPHY) {
            console.log(`\n${JSON.stringify(input, null, 2)}`);
        }
        console.log(`\n=>\n\n${formatForPrinting(data.biography)}\n\n>>>>>\n`);
        return data.biography as string[];
    } else {
        return Promise.reject(
            `Failed to generate biography due to unexpected response from API: ${JSON.stringify(data, null, 2)}`,
        );
    }
}

/*
 * Moved into `@hector/schemas` on 2026-09-20, the way the bucketing rules did
 * when the admin needed them: this module imports `../code/data.ts`, which globs
 * the filesystem at module scope, so a service outside `astrosite/` cannot reach
 * anything defined here. Re-exported because `biography-lock.test.ts` and
 * `workflow-import-writes-nothing.test.ts` both read it off this module.
 */
export { biographiesToRegenerate };

async function updateBiographiesForEvent(_: HectorEvent) {
    const { regenerate, locked, alreadyPublished } = biographiesToRegenerate(getAllPlayers());
    const commitMessage: string[] = [];

    // Seeded with what the locked players already say rather than starting empty;
    // see `biographiesToRegenerate` for why that is load-bearing.
    const generatedBiographies: string[] = [...alreadyPublished];

    console.log(`Regenerating ${regenerate.length} biographies; ${locked.length} are locked.`);
    for (const player of locked) {
        console.log(
            `Leaving ${getPlayerName(player)}'s biography alone: biographyLocked is set, so this one is ` +
                `somebody's rather than the generator's. Clear the field to hand it back.`,
        );
    }

    for (const player of regenerate) {
        const input = await extractPlayerBiographyInput(player, generatedBiographies);
        const biography = await generateBiography(input);
        const playerName = getPlayerName(player);
        commitMessage.push(playerName);
        console.log(`- Updated biography for ${playerName}`);
        await updatePlayerData({ ...player, biography });
        generatedBiographies.push(...biography);
    }
    if (commitMessage.length > 0) {
        const left = locked.length > 0 ? ` (${locked.length} left alone, biographyLocked)` : "";
        writeFileSync(
            pathToCommitMessage,
            `Updated biographies for ${commitMessage.length} players${left}:\n${commitMessage.map((m) => `- ${m}`).join("\n")}`,
        );
    }
}

function eventToUpdateBiographiesFor(): HectorEvent | undefined {
    const upcomingEvents = hectorEvents.filter(isUpcomingEvent).filter(hasParticipants);
    return upcomingEvents[0] as HectorEvent | undefined;
}

const run = async () => {
    console.log("Updating player biographies...");
    resetCommitMessage();
    const event = eventToUpdateBiographiesFor();
    if (event) {
        await updateBiographiesForEvent(event);
    }
    console.log("Done updating player biographies.");
};

// Only when this file is the thing being run, as in `update-handicaps.ts`. The tests
// import it for `biographiesToRegenerate`, and without this an import empties the
// commit message file, rescrapes the club list, rewrites `clubs.json` from the answer,
// and starts generating 45 biographies against a live Cloud Function.
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
    run();
}
