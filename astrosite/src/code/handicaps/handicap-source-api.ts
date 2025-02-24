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
    resolveClubMembership: (firstName: string, lastName: string) => Promise<string[]>;
}