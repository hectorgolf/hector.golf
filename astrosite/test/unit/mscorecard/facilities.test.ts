import { expect, describe, it } from "vitest";

import {
    courseForNines,
    facilityIdOf,
    groupCoursesByFacility,
    ninePairOf,
} from "../../../src/code/mscorecard/facilities.ts";
import { roundReferenceFor } from "../../../src/code/mscorecard/roster.ts";
import type { CourseSummary, RosterPlayer } from "../../../src/code/mscorecard/types.ts";

/**
 * Real search results, captured from a nearby-courses query around Helsinki.
 *
 * Nevas Golf and Nurmijarven Golfklubi are three-nine facilities that appear once
 * per pair of nines. Pickala Golf and GolfStar Kurk Golf are the counter-examples:
 * several courses under one club name that are genuinely separate, and must not be
 * merged.
 */
const SEARCH_RESULTS: CourseSummary[] = [
    {
        "courseID": "0121568050825406011",
        "courseName": "",
        "clubName": "Hirsala Golf",
        "city": "Kirkkonummi",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.118091",
        "longitude": "24.5219159",
        "numHoles": 18
    },
    {
        "courseID": "0121119275009171",
        "courseName": "Hill",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 9
    },
    {
        "courseID": "0121248388510811",
        "courseName": "Hill-Lake",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 18
    },
    {
        "courseID": "0121214489563529",
        "courseName": "Hill-Valley",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 18
    },
    {
        "courseID": "0121619647156776698",
        "courseName": "Lake",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 9
    },
    {
        "courseID": "0121531513738766592",
        "courseName": "Lake-Valley",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 18
    },
    {
        "courseID": "0121619647127311510",
        "courseName": "Valley",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 9
    },
    {
        "courseID": "0121087312259030",
        "courseName": "Valley-Lake",
        "clubName": "GolfStar Kurk Golf",
        "city": "Evitskog",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.1810683",
        "longitude": "24.388194",
        "numHoles": 18
    },
    {
        "courseID": "0121184662556869",
        "courseName": "Kettu + Karppi",
        "clubName": "Nevas Golf",
        "city": "SÖDERKULLA",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.2873552",
        "longitude": "25.4093559",
        "numHoles": 18
    },
    {
        "courseID": "0131184662556869",
        "courseName": "Kettu + Rapu",
        "clubName": "Nevas Golf",
        "city": "SÖDERKULLA",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.2873552",
        "longitude": "25.4093559",
        "numHoles": 18
    },
    {
        "courseID": "0231184662556869",
        "courseName": "Karppi + Rapu",
        "clubName": "Nevas Golf",
        "city": "SÖDERKULLA",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.2873552",
        "longitude": "25.4093559",
        "numHoles": 18
    },
    {
        "courseID": "0121282058430233",
        "courseName": "Forest",
        "clubName": "Pickala Golf",
        "city": "Störsvik",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.0749086",
        "longitude": "24.2828326",
        "numHoles": 18
    },
    {
        "courseID": "0121311414664982",
        "courseName": "Garden",
        "clubName": "Pickala Golf",
        "city": "Störsvik",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.0749086",
        "longitude": "24.2828326",
        "numHoles": 18
    },
    {
        "courseID": "0121341891567927",
        "courseName": "Park",
        "clubName": "Pickala Golf",
        "city": "Störsvik",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.0749086",
        "longitude": "24.2828326",
        "numHoles": 18
    },
    {
        "courseID": "0121339613308882",
        "courseName": "Seaside",
        "clubName": "Pickala Golf",
        "city": "Störsvik",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.0749086",
        "longitude": "24.2828326",
        "numHoles": 18
    },
    {
        "courseID": "0121338133263756",
        "courseName": "A + B",
        "clubName": "Nurmijärven Golfklubi",
        "city": "Nurmijärvi",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.5007996",
        "longitude": "24.5778949",
        "numHoles": 18
    },
    {
        "courseID": "0131338133263756",
        "courseName": "A + C",
        "clubName": "Nurmijärven Golfklubi",
        "city": "Nurmijärvi",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.5007996",
        "longitude": "24.5778949",
        "numHoles": 18
    },
    {
        "courseID": "0231338133263756",
        "courseName": "B + C",
        "clubName": "Nurmijärven Golfklubi",
        "city": "Nurmijärvi",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.5007996",
        "longitude": "24.5778949",
        "numHoles": 18
    },
    {
        "courseID": "0121119438873250",
        "courseName": "Par 3",
        "clubName": "Nurmijärven Golfklubi",
        "city": "Nurmijärvi",
        "state": "Uusimaa",
        "country": "Finland",
        "latitude": "60.5007996",
        "longitude": "24.5778949",
        "numHoles": 9
    }
];

const facilities = groupCoursesByFacility(SEARCH_RESULTS);
const facility = (clubName: string, index = 0) =>
    facilities.filter((f) => f.clubName === clubName)[index]!;

describe("Recognising nine-pair variants of the same facility", () => {
    describe("reading a course ID", () => {
        it("splits it into the nine pair and the facility", () => {
            expect(ninePairOf("0121184662556869")).toEqual([1, 2]);
            expect(ninePairOf("0131184662556869")).toEqual([1, 3]);
            expect(ninePairOf("0231184662556869")).toEqual([2, 3]);
            expect(facilityIdOf("0231184662556869")).toEqual("184662556869");
        });

        it("gives the three Nevas variants one shared facility ID", () => {
            const ids = SEARCH_RESULTS.filter((c) => c.clubName === "Nevas Golf").map((c) =>
                facilityIdOf(c.courseID),
            );

            expect(ids).toHaveLength(3);
            expect(new Set(ids).size).toEqual(1);
        });

        it("reads a nine-hole card's ID, where the second nine is 0", () => {
            // Tapiola's back nine alone: same facility as its 18-hole 0121... ID.
            expect(ninePairOf("0201371825104923099")).toEqual([2, 0]);
            expect(facilityIdOf("0201371825104923099")).toEqual("371825104923099");
            expect(facilityIdOf("0121371825104923099")).toEqual("371825104923099");
        });

        it("treats an unrecognised ID as its own facility rather than guessing", () => {
            // Never merge two clubs just because a layout is unfamiliar.
            expect(facilityIdOf("weird-id")).toEqual("weird-id");
            expect(ninePairOf("weird-id")).toBeUndefined();
        });
    });

    describe("grouping a search result", () => {
        it("collapses Nevas Golf's three pairings into one facility", () => {
            const nevas = facility("Nevas Golf");

            expect(facilities.filter((f) => f.clubName === "Nevas Golf")).toHaveLength(1);
            expect(nevas.hasMultipleNinePairings).toBe(true);
            expect(nevas.courses.map((c) => c.courseName)).toEqual([
                "Kettu + Karppi",
                "Kettu + Rapu",
                "Karppi + Rapu",
            ]);
        });

        it("keeps a club's standalone course separate from its nine pairings", () => {
            // Nurmijärvi has A+B, A+C, B+C *and* an unrelated Par 3 course.
            const grouped = facilities.filter((f) => f.clubName === "Nurmijärven Golfklubi");

            expect(grouped).toHaveLength(2);
            expect(grouped.map((f) => f.courses.length).sort()).toEqual([1, 3]);
            expect(grouped.find((f) => f.courses.length === 1)!.courses[0]!.courseName).toEqual("Par 3");
        });

        it("does not merge distinct courses that merely share a club name", () => {
            // Four separate eighteens, not one facility played four ways.
            const pickala = facilities.filter((f) => f.clubName === "Pickala Golf");
            const kurk = facilities.filter((f) => f.clubName === "GolfStar Kurk Golf");

            expect(pickala).toHaveLength(4);
            expect(kurk).toHaveLength(7);
            expect(pickala.every((f) => !f.hasMultipleNinePairings)).toBe(true);
        });

        it("leaves an ordinary single course alone", () => {
            const hirsala = facility("Hirsala Golf");

            expect(hirsala.courses).toHaveLength(1);
            expect(hirsala.hasMultipleNinePairings).toBe(false);
        });

        it("carries the club's location onto the facility", () => {
            expect(facility("Nevas Golf")).toMatchObject({
                facilityID: "184662556869",
                city: "SÖDERKULLA",
                country: "Finland",
            });
        });
    });

    describe("choosing which variant to create a round against", () => {
        const nevas = facility("Nevas Golf");

        it("prefers the variant whose own pair is exactly the nines being played", () => {
            expect(courseForNines(nevas, 1, 2).courseName).toEqual("Kettu + Karppi");
            expect(courseForNines(nevas, 2, 3).courseName).toEqual("Karppi + Rapu");
        });

        it("ignores the order, since a pair is unordered", () => {
            // A crossover start is nine1: 2, nine2: 1 — still the Kettu + Karppi card.
            expect(courseForNines(nevas, 2, 1).courseName).toEqual("Kettu + Karppi");
        });

        it("falls back to a variant that at least contains the nine being played", () => {
            // No variant is "Rapu + Rapu", so any pairing including Rapu will do.
            expect(courseForNines(nevas, 3, 3).courseName).toMatch(/Rapu/);
            expect(courseForNines(nevas, 3, 0).courseName).toMatch(/Rapu/);
        });

        it("matches a nine-hole variant against the single nine being played", () => {
            const tapiola = {
                facilityID: "371825104923099",
                clubName: "Tapiola Golf",
                city: "Espoo",
                state: "Uusimaa",
                country: "Finland",
                latitude: "",
                longitude: "",
                hasMultipleNinePairings: true,
                courses: [
                    { courseID: "0121371825104923099", courseName: "18-hole course" },
                    { courseID: "0201371825104923099", courseName: "back nine" },
                ] as CourseSummary[],
            };

            expect(courseForNines(tapiola, 2, 0).courseName).toEqual("back nine");
            expect(courseForNines(tapiola, 1, 2).courseName).toEqual("18-hole course");
        });

        it("returns the only course for an ordinary facility", () => {
            expect(courseForNines(facility("Hirsala Golf"), 2, 0).courseID).toEqual("0121568050825406011");
        });
    });
});

/**
 * Real roster entries, captured after adding a friend.
 *
 * Three states appear in one roster: a player invented locally, a friend request
 * still pending, and a friend link that has been accepted.
 */
describe("Referring to a roster player inside a round", () => {
    const OWN_USER_ID = "694833";

    const rosterPlayer = (over: Partial<RosterPlayer>): RosterPlayer => ({
        name: "?",
        playerID: "?",
        shortName: "?",
        email: "",
        gender: "1",
        hcp: 36,
        hcpType: "0",
        club: "",
        isDefaultPlayer: false,
        friendStatus: 0,
        friendUserID: "0",
        friendPlayerID: "",
        ...over,
    });

    it("uses our own entry for a player we invented", () => {
        const lotta = rosterPlayer({ name: "Lotta", playerID: "1619952902663" });

        expect(roundReferenceFor(lotta, OWN_USER_ID)).toEqual({
            playerID: "1619952902663",
            playerUserID: OWN_USER_ID,
        });
    });

    it("uses our own entry while a friend request is still pending", () => {
        // Added but not yet accepted: they have a user ID, but no player record of
        // their own that we could point at.
        const jarkko = rosterPlayer({
            name: "Jarkko Kailanto",
            playerID: "1788737332464851",
            friendStatus: 1,
            friendUserID: "10981498",
            friendPlayerID: "",
        });

        expect(roundReferenceFor(jarkko, OWN_USER_ID)).toEqual({
            playerID: "1788737332464851",
            playerUserID: OWN_USER_ID,
        });
    });

    it("uses the friend's own record once the link is accepted", () => {
        const toni = rosterPlayer({
            name: "Toni Marttila",
            playerID: "1788645892735896",
            friendStatus: 2,
            friendUserID: "207653",
            friendPlayerID: "1438582589166807",
        });

        // Exactly what the app put in the round: his ID, under his account, not our
        // copy of him under ours.
        expect(roundReferenceFor(toni, OWN_USER_ID)).toEqual({
            playerID: "1438582589166807",
            playerUserID: "207653",
        });
    });

    it("falls back to our entry if an accepted link is missing its player record", () => {
        const broken = rosterPlayer({ playerID: "local", friendStatus: 2, friendUserID: "207653" });

        expect(roundReferenceFor(broken, OWN_USER_ID).playerUserID).toEqual(OWN_USER_ID);
    });
});
