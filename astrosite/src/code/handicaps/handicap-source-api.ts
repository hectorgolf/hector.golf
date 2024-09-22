export type HandicapSource = {
    name: string,
    getPlayerHandicap: (firstName: string, lastName: string, clubNameOrAbbreviation: string) => Promise<number|undefined>
}