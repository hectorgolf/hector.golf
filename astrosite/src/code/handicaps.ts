import cryptojs from 'crypto-js';
const { MD5 } = cryptojs;

import { type Player } from '../schemas/players';


const standardRequestHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Origin': 'https://teetime.fi',
    'Referer': 'https://teetime.fi/',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"'
}

export type TeetimeClub = {
    name: string,
    number: string,
    abbrevitation: string
}

export type TeetimePlayer = {
    numberid: string,
    firstName: string,
    lastName: string,
    club: TeetimeClub,
    handicap: number,
    gender: 'male'|'female',
    birthDate: string
}

export const fetchClubs = async (): Promise<Array<TeetimeClub>> => {
    const response = await fetch('https://www.teetime.fi/backend/club?includeExternal=true', {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*'
        }
    })
    const data = await response.json()
    return data
        .map((club:any) => ({ ...club, name: club.marketingName || club.name, marketingName: undefined }) as TeetimeClub)
        .sort((a: TeetimeClub, b: TeetimeClub) => a.name.localeCompare(b.name))
}

export const login = async (clubNumber: string, username: string, password: string): Promise<string> => {
    const payload = {
        clubNumber: clubNumber,
        username: username,
        password: MD5(password).toString(),
        authData: { trustCode: null }
    }
    const response = await fetch('https://www.teetime.fi/backend/session', {
        method: 'POST',
        headers: standardRequestHeaders,
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data.token;
}

export const fetchPlayer = async (token: string, clubNumber: string, firstName: string, lastName: string): Promise<TeetimePlayer|undefined> => {
    const url = ((): string => {
        const obj = new URL(`https://www.teetime.fi/backend/club/${encodeURIComponent(clubNumber)}/player/`)
        obj.searchParams.append('firstName', firstName)
        obj.searchParams.append('lastName', lastName)
        obj.searchParams.append('token', token)
        return obj.href
    })();
    // const url = `https://www.teetime.fi/backend/club/${encodeURIComponent(clubNumber)}/player/?firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&token=${encodeURIComponent(token)}`
    console.log(url)
    const response = await fetch(url, {
        headers: standardRequestHeaders
    });
    try {
        const data = await response.json();
        if (data.length === 0) {
            return undefined;
        }
        if (data.length > 1) {
            console.warn(`Expected exactly one player, but found ${data.length} players in ${clubNumber} by name of ${firstName} ${lastName}: ${JSON.stringify(data, null, 2)}`);
        }
        const player = data[0];
        const club = await fetchClub(player.club.number);
        return { ...player, club: club, holes: undefined };
    } catch (err) {
        return undefined;
    }
}

export const fetchHandicap = async (token: string, clubNumber: string, firstName: string, lastName: string): Promise<number|undefined> => {
    const player = await fetchPlayer(token, clubNumber, firstName, lastName);
    if (player) {
        return player.handicap;
    }
    return undefined;
}

const isProd = import.meta.env.PROD;
const teetimeClubNumber = import.meta.env.TEETIME_CLUB_NUMBER
const teetimeUsername = import.meta.env.TEETIME_USERNAME
const teetimePassword = import.meta.env.TEETIME_PASSWORD

console.log(`isProd? ${isProd}  isDev? ${import.meta.env.DEV}`);
console.log(`teetimeClubNumber: ${teetimeClubNumber}`);
console.log(`teetimeUsername:   ${teetimeUsername}`);
console.log(`teetimePassword:   ${teetimePassword?.replace(/./g, '*')}`);

export const getPlayerHandicap = async (player: Player): Promise<number|undefined> => {
    if (player.club) {
        if (!!teetimeClubNumber && !!teetimeUsername && !!teetimePassword) {
            const clubNumber = await resolveClubNumber(player.club);
            if (clubNumber) {
                const token = await login(teetimeClubNumber, teetimeUsername, teetimePassword);
                return await fetchHandicap(token, clubNumber, player.name.first, player.name.last);
            }
        } else {
            console.log(`Missing teetime.fi credentials – computing a "random" handicap for ${player.name.first} ${player.name.last}...`);
            return player.name.first.length + player.name.last.length + (player.club.length / 10);
        }
    }
    return undefined
}

export const resolveClubNumber = async (clubNameOrNumber: string): Promise<string|undefined> => {
    return (await fetchClub(clubNameOrNumber))?.number;
}

export const fetchClub = async (clubNameOrNumber: string): Promise<TeetimeClub|undefined> => {
    const clubs = await fetchClubs();
    const club = clubs.find(club => {
        if (club.number && club.number === clubNameOrNumber) return true;
        if (club.name && club.name.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
        if (club.abbrevitation && club.abbrevitation.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
        return false;
    });
    if (club) {
        return club;
    }
    return undefined;
}
