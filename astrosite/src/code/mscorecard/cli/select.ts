/**
 * The interactive part: choosing what round to create.
 *
 * Everything here is questions and defaults. Nothing is written to mScorecard until
 * `run.ts` acts on what comes back.
 */

import { courseForNines, MScorecardClient, roundReferenceFor, type CourseFacility } from "../index.ts";
import type { Course, CourseSummary, RosterPlayer, Tee } from "../types.ts";
import { courseHandicap } from "./handicap.ts";
import { lengthOf, nineName, playableConfigurations, ratingsFor, type NineConfiguration } from "./nines.ts";
import type { Prompter } from "./prompts.ts";
import { byPreferredFirst } from "./scorecard.ts";
import { sum } from "./util.ts";

export const DEFAULT_CLUB_SEARCH = "Tapiola";
export const DEFAULT_PLAYER_NAME = "Lasse Koskela";
export const DEFAULT_MARKER_NAME = "Toni Marttila";

/** Everything chosen before anything is written. */
export type RoundSetup = {
    facility: CourseFacility;
    summary: CourseSummary;
    course: Course;
    config: NineConfiguration;
    tee: Tee;
    player: RosterPlayer;
    courseHcp: number;
};

/**
 * Asks for the club, the nines, the tee and the player.
 *
 * A club built from three nines is listed once per *pair* of nines, so Nevas Golf
 * comes back three times. Grouping by facility presents it as one club and leaves
 * the nine choice to the next prompt.
 */
export async function chooseRound(client: MScorecardClient, prompt: Prompter): Promise<RoundSetup> {
    let facilities: CourseFacility[] = [];
    let search = DEFAULT_CLUB_SEARCH;
    while (facilities.length === 0) {
        search = await prompt.ask("\nSearch for a club", search);
        facilities = await client.searchFacilities(search, "Finland");
        if (facilities.length === 0) console.log(`No course matching "${search}". Try again.`);
    }

    const facility = await prompt.choose("Which club", facilities, (f) => {
        const first = f.courses[0]!;
        const variants = f.hasMultipleNinePairings ? ` — ${f.courses.length} nine pairings` : "";
        const named = first.courseName ? ` — ${first.courseName}` : "";
        return `${f.clubName}${f.hasMultipleNinePairings ? "" : named} (${f.city})${variants}`;
    });

    // Any variant's detail rates every combination the facility offers, so the first
    // one is enough to build the menu from.
    let summary: CourseSummary = facility.courses[0]!;
    let course: Course = await client.getCourse(summary.courseID);

    const configurations = playableConfigurations(course);
    if (configurations.length === 0) {
        throw new Error(`${course.courseName} publishes no rated nine combinations, so no round can be created.`);
    }
    const config = await prompt.choose(
        "Which nines",
        configurations,
        (c) => `${c.label.padEnd(34)} ${c.holes} holes, par ${sum(c.pars)}`,
    );

    // The chosen nines may belong to a different variant than the one we happened to
    // read. Switch to it and re-read, since tee IDs come from a specific course.
    const target = courseForNines(facility, config.nine1, config.nine2);
    if (target.courseID !== summary.courseID) {
        console.log(`\nUsing the "${target.courseName}" card for these nines.`);
        summary = target;
        course = await client.getCourse(target.courseID);
    }

    const tee = await prompt.choose("Which tee", course.tees, (t) => {
        const ratings = ratingsFor(t, config);
        const metres = lengthOf(t, config);
        const rating = ratings ? `slope ${ratings.slope}, CR ${ratings.cr}` : "not rated for these nines";
        return `${t.name.padEnd(12)} ${metres} m, ${rating}`;
    });

    if (!ratingsFor(tee, config)) {
        console.log(`\nWarning: the ${tee.name} tees carry no ${config.ratingsKey}, so the handicap below is a guess.`);
    }

    // A round PUT sends no names — the server resolves each playerID against the
    // caller's own roster — so only people on this list can be scored.
    const roster = await client.listRoster();
    const player = await prompt.choose(
        "Which player",
        [...roster].sort(byPreferredFirst(DEFAULT_PLAYER_NAME)),
        (p) => `${p.name.padEnd(20)} HI ${p.hcp}${p.isDefaultPlayer ? "  (default player)" : ""}`,
    );

    const courseHcp = courseHandicap(player, tee, course);
    console.log(`\n${player.name}: HI ${player.hcp} (hcpType ${player.hcpType}) -> course handicap ${courseHcp}`);
    console.log("Check that against what the app shows before submitting — see courseHandicap() below.");

    return { facility, summary, course, config, tee, player, courseHcp };
}
