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
};
