import type { CourseSummary, NineSelection } from "./types.ts";

/**
 * Grouping the nine-pair variants of a multi-nine club back into one facility.
 *
 * A club whose 18-hole rounds are made from three nines appears once per *pair* of
 * nines. Nevas Golf comes back from a search three times — "Kettu + Karppi",
 * "Kettu + Rapu", "Karppi + Rapu" — as does Nurmijarven Golfklubi with "A + B",
 * "A + C" and "B + C".
 *
 * The course ID is what ties them together. It is `0<nine1><nine2>1` followed by an
 * ID for the facility itself, so the three Nevas entries differ only in those two
 * digits:
 *
 *     0[12]1184662556869   Kettu + Karppi
 *     0[13]1184662556869   Kettu + Rapu
 *     0[23]1184662556869   Karppi + Rapu
 *
 * Club name is not a substitute. In a 100-course sample, 19 clubs had more than one
 * course and only these two were nine-pair facilities; the rest — Pickala Golf's
 * four separate eighteens, GolfStar Kurk Golf's seven — are genuinely different
 * courses that happen to share a name. Nurmijarvi makes the point twice over: its
 * standalone Par 3 course has its own facility ID and stays separate.
 */

// The second nine is 0 on a nine-hole card, so only the first digit is 1-9:
// Tapiola's back nine is 0[20]1371825104923099, the same facility as 0[12]1...
const COURSE_ID = /^0([1-9])([0-9])1(.+)$/;

/** The two nines a course ID stands for, or undefined if it is not in that format. */
export function ninePairOf(courseID: string): [NineSelection, NineSelection] | undefined {
    const match = COURSE_ID.exec(courseID);
    if (!match) return undefined;
    return [Number(match[1]) as NineSelection, Number(match[2]) as NineSelection];
}

/**
 * A stable key for the golf facility a course belongs to.
 *
 * Course IDs in an unrecognised format are their own facility, so an unfamiliar
 * layout can never merge two clubs by accident.
 */
export function facilityIdOf(courseID: string): string {
    return COURSE_ID.exec(courseID)?.[3] ?? courseID;
}

/** A club, together with every nine-pair variant of it the search returned. */
export type CourseFacility = {
    facilityID: string;
    clubName: string;
    city: string;
    state: string;
    country: string;
    latitude: string;
    longitude: string;
    /** Every variant, e.g. the three Nevas pairings. A normal course has exactly one. */
    courses: CourseSummary[];
    /** True when this club is played as pairs drawn from three or more nines. */
    hasMultipleNinePairings: boolean;
};

/**
 * Collapses nine-pair variants into one entry per facility, preserving search order.
 *
 * Keyed on facility ID *and* club name: no cross-club ID collision was observed, but
 * requiring both means a collision could not silently merge two clubs. Names are
 * compared trimmed, since the API does return them padded — "St. Laurence Golf ".
 */
export function groupCoursesByFacility(courses: readonly CourseSummary[]): CourseFacility[] {
    const facilities = new Map<string, CourseFacility>();
    for (const course of courses) {
        const facilityID = facilityIdOf(course.courseID);
        const clubName = course.clubName.trim();
        const key = `${facilityID} ${clubName}`;
        const existing = facilities.get(key);
        if (existing) {
            existing.courses.push(course);
            existing.hasMultipleNinePairings = true;
            continue;
        }
        facilities.set(key, {
            facilityID,
            clubName,
            city: course.city,
            state: course.state,
            country: course.country,
            latitude: course.latitude,
            longitude: course.longitude,
            courses: [course],
            hasMultipleNinePairings: false,
        });
    }
    return [...facilities.values()];
}

/**
 * The variant of a facility to create a round against for a given pair of nines.
 *
 * Every variant's detail rates all of the facility's nine combinations, so any of
 * them describes the round correctly. Whether the server accepts a round whose
 * nines fall outside the ID's own pair is not something the captures show, so this
 * prefers the variant that covers them: an exact pair match first, then one that at
 * least contains both nines, then the facility's first course.
 */
export function courseForNines(
    facility: CourseFacility,
    nine1: NineSelection,
    nine2: NineSelection,
): CourseSummary {
    const wanted = ninesOf(nine1, nine2);
    const pairs = facility.courses.map((course) => {
        const pair = ninePairOf(course.courseID);
        return { course, nines: pair ? ninesOf(pair[0], pair[1]) : undefined };
    });

    const exact = pairs.find(
        ({ nines }) => nines && nines.size === wanted.size && [...wanted].every((nine) => nines.has(nine)),
    );
    const covering = pairs.find(({ nines }) => nines && [...wanted].every((nine) => nines.has(nine)));
    return (exact ?? covering)?.course ?? facility.courses[0]!;
}

/** The distinct nines a configuration covers. `0` means "no second nine". */
function ninesOf(nine1: NineSelection, nine2: NineSelection): Set<NineSelection> {
    return new Set(nine2 ? [nine1, nine2] : [nine1]);
}
