type GolfClubSource = { name: string, id: string };

export type GolfClub = {
    name: string,
    abbreviation: string,
    sources: GolfClubSource[],
}

export type HandicapSource = {
    /**
     * Name of the source.
     */
    name: string;

    /**
     * Fetch the given player's handicap from the source.
     *
     * @param firstName Player's first name
     * @param lastName Player's last name
     * @param clubNameOrAbbreviation Club name or abbreviation (e.g. "TaG" or "Tapiola Golf")
     * @returns The player's handicap, or undefined if not found.
     */
    getPlayerHandicap: (firstName: string, lastName: string, clubNameOrAbbreviation: string) => Promise<number|undefined>;

    /**
     * Attempt to find a player's home club by their first and last name.
     *
     * @param firstName Player's first name
     * @param lastName Player's last name
     * @returns The player's home club(s), or an empty array if not found.
     */
    resolveClubMembership: (firstName: string, lastName: string) => Promise<GolfClub[]>;

    /**
     * Get all clubs from the source.
     *
     * @returns All clubs from the source.
     */
    getClubs(): Promise<GolfClub[]>;
}

/**
 * A null handicap source that returns undefined for all handicaps and an empty array for club membership.
 */
export class NullHandicapSource implements HandicapSource {
    constructor(readonly name: string) {
        this.name = `${name} (disabled)`;
    }
    getPlayerHandicap(_firstName: string, _lastName: string, _clubNameOrAbbreviation: string): Promise<number|undefined> {
        return Promise.resolve(undefined)
    }
    resolveClubMembership(_firstName: string, _lastName: string): Promise<GolfClub[]> {
        return Promise.resolve([])
    }
    getClubs(): Promise<GolfClub[]> {
        return Promise.resolve([])
    }
};

/**
 * Thrown when a club-membership scan could not ask every club.
 *
 * `resolveClubMembership` answers "which clubs is this player a member of" by
 * asking each of ~140 clubs in turn. A lookup that fails — WiseGolf answering
 * HTTP 429, most likely, because 140 requests per player is enough to be
 * throttled — used to be indistinguishable from a club answering "not a member",
 * so an incomplete scan produced a confident-looking answer.
 *
 * That is harmless while the only caller reports. It stops being harmless when
 * one writes: a player genuinely in two clubs, with one of those lookups
 * throttled, presents as a player in exactly one club, and the rule "assign only
 * when exactly one club matches" quietly becomes "assign the one we managed to
 * reach". See `docs/current/architecture.md` §13.
 *
 * So a scan that could not complete refuses to answer instead. Both callers
 * already treat a throw as "no club for this player this run" —
 * `update-player-club-memberships.ts` catches per player, and the admin's
 * club-memberships job catches per source — which is the outcome that was wanted
 * all along.
 */
export class IncompleteLookupError extends Error {
    constructor(
        readonly subject: string,
        readonly asked: number,
        readonly failed: number
    ) {
        super(
            `Could not ask every club about ${subject}: ${failed} of ${asked} lookups failed. ` +
                `Refusing to answer, because a lookup that failed is not a club that said no.`
        );
        this.name = "IncompleteLookupError";
    }
}

/**
 * The clubs a scan found, or a refusal if it could not ask them all.
 *
 * Pure, exported and named so the rule has somewhere to be tested: the scan
 * around it is 140 sequential HTTP requests, and `packages/wisegolf` has no test
 * runner of its own. `admin/test/wisegolf-incomplete-lookups.test.ts` covers it.
 *
 * Any failure is disqualifying, which is stricter than it first looks but is the
 * only honest reading. Every outcome is poisoned by a missing answer: zero found
 * might have been one, one found might have been two, and two or more is already
 * a refusal. There is no count of failures small enough to ignore.
 */
export function clubsOrRefuse(
    subject: string,
    found: GolfClub[],
    asked: number,
    failed: number,
): GolfClub[] {
    if (failed > 0) throw new IncompleteLookupError(subject, asked, failed);
    return found;
}
