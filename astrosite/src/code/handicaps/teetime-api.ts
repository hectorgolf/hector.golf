import { fetch, Response } from "fetch-h2";
import cryptojs from "crypto-js";
const { MD5 } = cryptojs;
import moize from "moize";
import { ms } from "itty-time";
import mime from "mime";

import { NullHandicapSource, type HandicapSource, type GolfClub } from "./handicap-source-api";
import { describeRequest, describeResponse, describeResponseBody } from "./http-helpers";

const standardRequestHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    Origin: "https://teetime.fi",
    Referer: "https://teetime.fi/",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
};

export type TeetimeClub = {
    name: string;
    number: string;
    abbrevitation: string; // sic!
};

export type TeetimePlayer = {
    numberid: string;
    firstName: string;
    lastName: string;
    club: TeetimeClub;
    handicap: number;
    gender: "male" | "female";
    birthDate: string;
};

const SOURCE_NAME = "Teetime";

function extractClubsFromResponseData(data: any): Array<TeetimeClub> {
    function mapper(club: any): TeetimeClub {
        return { ...club, name: club.marketingName || club.name, marketingName: undefined };
    }
    return data.map(mapper).sort((a: TeetimeClub, b: TeetimeClub) => a.name.localeCompare(b.name));
}

const fetchClubs = moize.maxAge(ms("1 hour"))(async (): Promise<Array<TeetimeClub>> => {
    const url = "https://www.teetime.fi/backend/club?includeExternal=true";
    console.log(`Fetching clubs from ${url}`);
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
        },
    });
    if (response.ok) {
        const data = await response.json();
        const clubs = extractClubsFromResponseData(data);
        console.log(`Got ${clubs.length} clubs from ${SOURCE_NAME}`);
        return clubs;
    } else {
        return Promise.reject(
            `Failed to fetch clubs from https://www.teetime.fi/backend/club?includeExternal=true (HTTP ${response.status})`
        );
    }
});

const sanitizePassword = (obj: any): any => {
    if ("password" in obj) {
        return { ...obj, password: "**********" };
    }
    return obj;
};

const extractJsonFromResponse = async (response: Response): Promise<any> => {
    if (!response.ok) {
        const error =
            `Failed to extract JSON response from Teetime.fi login request! ` +
            `Response to ${describeRequest(response)}:\n` +
            `${describeResponse(response)}\n` +
            `${await describeResponseBody(response)}`;
        console.log(error);
        return Promise.reject(error);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || mime.getExtension(contentType) !== "json") {
        return Promise.reject(`Unexpected content-type from ${response.url}: ${contentType}`);
    }
    try {
        return await response.json();
    } catch (err: any) {
        console.error(`Failed to parse JSON from ${response.url}:`, err.message || err);
        console.error(`Response body: ${await response.text()}`);
        return Promise.reject(`Failed to parse JSON from ${response.url}: ${err.message || err}`);
    }
};

const login = moize.maxAge(ms('15 minutes'))(async (clubNumberOrAbbreviation: string, username: string, password: string): Promise<string> => {
    const clubNumber = await resolveClubNumber(clubNumberOrAbbreviation);
    const payload = {
        clubNumber: clubNumber,
        username: username,
        password: MD5(password).toString(),
        authData: { trustCode: null },
    };
    console.log(
        `Logging in to Teetime.fi with ${JSON.stringify(sanitizePassword({ ...payload, password: password }))}`
    );
    const response = await fetch("https://www.teetime.fi/backend/session", {
        method: "POST",
        headers: standardRequestHeaders,
        allowForbiddenHeaders: true,
        body: JSON.stringify(payload),
    });
    try {
        const data = await extractJsonFromResponse(response);
        return data.token ? data.token : Promise.reject(`Failed to login to Teetime.fi: ${JSON.stringify(data)}`);
    } catch (error) {
        return Promise.reject(error);
    }
});

const roundToTenths = (num: number): number => Math.round(num * 10) / 10;

const fetchPlayer = moize.maxAge(ms("10 minutes"))(async (
    token: string,
    clubNumber: string,
    firstName: string,
    lastName: string
): Promise<TeetimePlayer | undefined> => {
    const url = ((): string => {
        const obj = new URL(`https://www.teetime.fi/backend/club/${encodeURIComponent(clubNumber)}/player/`);
        obj.searchParams.append("firstName", firstName);
        obj.searchParams.append("lastName", lastName);
        obj.searchParams.append("token", token);
        return obj.href;
    })();
    const response = await fetch(url, {
        headers: standardRequestHeaders,
        allowForbiddenHeaders: true,
    });
    if (response.ok) {
        try {
            const data = await response.json();
            if (data.length === 0) {
                return undefined;
            }
            if (data.length > 1) {
                console.warn(
                    `Expected exactly one player, but found ${data.length} players in ${clubNumber} by name of ${firstName} ${lastName}: ${JSON.stringify(data, null, 2)}`
                );
            }
            const player = data[0];
            const club = await fetchClub(player.club.number);
            return {
                ...player,
                club: club,
                holes: undefined,
                handicap: roundToTenths(player.handicap) || 0,
            } as TeetimePlayer;
        } catch (err: any) {
            console.error(
                `Failed to fetch player ${firstName} ${lastName} from ${JSON.stringify(clubNumber)} at ${url}: ${err.message || err}`,
                err
            );
            return undefined;
        }
    } else {
        if (response.status !== 404) {
            const statusText =
                response.statusText && response.statusText !== `${response.status}` ? ` ${response.statusText}` : "";
            console.warn(`Failed to fetch player at ${url} (HTTP ${response.status + statusText})`);
        }
        return undefined;
    }
});

const fetchHandicap = async (
    token: string,
    clubNumber: string,
    firstName: string,
    lastName: string
): Promise<number | undefined> => {
    const player = await fetchPlayer(token, clubNumber, firstName, lastName);
    if (player) {
        return player.handicap;
    }
    return undefined;
};

const ENV = import.meta.env || process.env || {};
const teetimeClubNumber = ENV.TEETIME_CLUB_NUMBER;
const teetimeUsername = ENV.TEETIME_USERNAME;
const teetimePassword = ENV.TEETIME_PASSWORD;

if (!teetimeClubNumber || !teetimeUsername || !teetimePassword) {
    console.error(`Missing teetime.fi credentials:`);
    console.error(`TEETIME_CLUB_NUMBER: ${teetimeClubNumber ? teetimeClubNumber : "<MISSING>"}`);
    console.error(`TEETIME_USERNAME:   ${teetimeUsername ? teetimeUsername : "<MISSING>"}`);
    console.error(`TEETIME_PASSWORD:   ${teetimePassword ? teetimePassword.replace(/./g, "*") : "<MISSING>"}`);
    console.error(`Please try again and provide the missing environment variables.`);
    process.exit(1);
}
console.log(`teetimeClubNumber: ${teetimeClubNumber}`);
console.log(`teetimeUsername:   ${teetimeUsername}`);
console.log(`teetimePassword:   ${teetimePassword?.replace(/./g, "*")}`);

export const createTeetimeSession = async (): Promise<HandicapSource> => {
    try {
        const token = await login(teetimeClubNumber, teetimeUsername, teetimePassword);
        const _ = await fetchClubs(); // pre-fetch clubs
        return {
            name: SOURCE_NAME,
            getPlayerHandicap: async (
                firstName: string,
                lastName: string,
                clubNameOrAbbreviation: string
            ): Promise<number | undefined> => {
                return await getTeetimePlayerHandicap(firstName, lastName, clubNameOrAbbreviation, token);
            },
            resolveClubMembership: async (firstName: string, lastName: string): Promise<GolfClub[]> => {
                return await findTeetimePlayerClubs(firstName, lastName, token);
            },
            getClubs: async (): Promise<GolfClub[]> => {
                return (await fetchClubs()).map(convertTeetimeClubToGolfClub);
            },
        };
    } catch (error: any) {
        console.error(
            `Failed to create Teetime session (${error.message || error}) so returning a null handicap source for ${SOURCE_NAME}.`
        );
        return new NullHandicapSource(SOURCE_NAME);
    }
};

function convertTeetimeClubToGolfClub(club: TeetimeClub): GolfClub {
    return {
        name: club.name,
        abbreviation: club.abbrevitation,
        sources: [{ name: SOURCE_NAME, id: club.number }],
    }
}

const findTeetimePlayerClubs = moize.maxAge(ms('1 hour'))(async (firstName: string, lastName: string, token: string): Promise<GolfClub[]> => {
    const clubs = await fetchClubs();
    const clubAbbreviations: GolfClub[] = [];
    for (let club of clubs) {
        const player = await fetchPlayer(token, club.number, firstName, lastName);
        if (player) {
            clubAbbreviations.push(convertTeetimeClubToGolfClub(club));
        }
    }
    return Promise.resolve(clubAbbreviations);
});

const getTeetimePlayerHandicap = moize.maxAge(ms('1 hour'))(async (
    firstName: string,
    lastName: string,
    clubNameOrAbbreviation: string,
    token: string
): Promise<number | undefined> => {
    if (clubNameOrAbbreviation) {
        if (!!teetimeClubNumber && !!teetimeUsername && !!teetimePassword) {
            console.log(`Fetching handicap for ${firstName} ${lastName} at ${clubNameOrAbbreviation} from ${SOURCE_NAME}`)
            const clubNumber = await resolveClubNumber(clubNameOrAbbreviation);
            if (clubNumber) {
                return await fetchHandicap(token, clubNumber, firstName, lastName);
            }
        }
    }
    return undefined;
});

const resolveClubNumber = async (clubNameOrNumber: string): Promise<string | undefined> => {
    const club = await fetchClub(clubNameOrNumber);
    return club?.number;
};

const fetchClub = moize.maxAge(ms('1 hour'))(async (clubNameOrNumber: string): Promise<TeetimeClub | undefined> => {
    if (!clubNameOrNumber) {
        console.warn(`No club name or number provided - cannot fetch club`);
        return undefined;
    }
    const clubs = await fetchClubs();
    const club = clubs.find((club) => {
        if (club.number && club.number === clubNameOrNumber) return true;
        if (club.number && club.number.replace(/^0+/, "") === clubNameOrNumber.replace(/^0+/, "")) return true;
        if (club.name && club.name.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
        if (club.abbrevitation && club.abbrevitation.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
        return false;
    });
    if (club) {
        return club;
    }
    return undefined;
});
