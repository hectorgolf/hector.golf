import type { Course, Gender, RosterPlayer, Tee } from "../types.ts";
import { holeTableOf, ratingsFor, type NineConfiguration } from "./nines.ts";
import { sum } from "./util.ts";

/**
 * The playing handicap written onto the scorecard.
 *
 * The app computes this client-side and the server stores whatever it is sent, so
 * this is our decision to make. The rule below reproduces every value the *app*
 * has been seen to write:
 *
 *     Lasse   14.8 -> 17  Hirsala, white     14.8 x 131/113 + (72.6 - 73) = 16.76
 *     Lasse   14.1 -> 14  Tapiola, tee 57    14.1 x 123/113 + (70.5 - 72) = 13.85
 *     Lotta   54   -> 54  Hirsala, red       capped
 *     Toni    36   -> 36  hcpType 0, verbatim
 *
 * Three things are worth knowing. There *is* a course-rating term, `CR - Par`.
 * It uses the course's default eighteen-hole rating and par rather than the nines
 * actually played. And it is not halved for a nine-hole round — the captured
 * nine-hole rounds carry the full eighteen-hole figure, which `playingHandicapFor()`
 * converts at scoring time.
 *
 * **Check the number against what the app shows before submitting.** An earlier
 * version of this rule omitted the rating term and produced 15 where the app writes
 * 14; four values is a pattern, not a specification.
 */
export function courseHandicap(player: RosterPlayer, tee: Tee, course: Course): number {
    // hcpType "9" is a WHS index; "0" is a plain club handicap the app uses verbatim.
    if (player.hcpType !== "9") return Math.round(player.hcp);

    // The course's own default routing, not the nines being played.
    const defaultConfig = { nine1: course.nine1, nine2: course.nine2 } as NineConfiguration;
    const ratings = ratingsFor(tee, defaultConfig);
    const table = holeTableOf(course, { ...defaultConfig, holes: 18 } as NineConfiguration);
    if (!ratings || !table) return Math.min(54, Math.round(player.hcp));

    const female = (player.gender as Gender) === "0";
    const slope = female ? ratings.slopeW || ratings.slope : ratings.slope;
    const cr = female ? ratings.crW || ratings.cr : ratings.cr;
    const par = sum(table.pars);
    return Math.min(54, Math.round((player.hcp * slope) / 113 + (cr - par)));
}
