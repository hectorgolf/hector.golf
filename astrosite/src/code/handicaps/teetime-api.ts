import cryptojs from 'crypto-js'
const { MD5 } = cryptojs
import moize from 'moize'
import { ms } from 'itty-time'

import { type HandicapSource } from './handicap-source-api'


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

const fetchClubs = moize.maxAge(ms('1 hour'))(async (): Promise<Array<TeetimeClub>> => {
    console.log(`Fetching clubs from https://www.teetime.fi/backend/club?includeExternal=true`)
    const response = await fetch('https://www.teetime.fi/backend/club?includeExternal=true', {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*'
        }
    })
    if (response.ok) {
        const data = await response.json()
        const clubs =  data
            .map((club:any) => ({ ...club, name: club.marketingName || club.name, marketingName: undefined }) as TeetimeClub)
            .sort((a: TeetimeClub, b: TeetimeClub) => a.name.localeCompare(b.name))
        console.log(`Got ${clubs.length} clubs from teetime.fi`)
        return clubs
    } else {
        return Promise.reject(`Failed to fetch clubs from https://www.teetime.fi/backend/club?includeExternal=true (HTTP ${response.status})`)
    }
})

const sanitizePassword = (obj: any): any => {
    if ('password' in obj) {
        return { ...obj, password: obj.password.replace(/./g, '*') }
    }
    return obj
}

const login = async (clubNumberOrAbbreviation: string, username: string, password: string): Promise<string> => {
    const clubNumber = await resolveClubNumber(clubNumberOrAbbreviation)
    const payload = {
        clubNumber: clubNumber,
        username: username,
        password: MD5(password).toString(),
        authData: { trustCode: null }
    }
    console.log(`Logging in to Teetime.fi with ${JSON.stringify(sanitizePassword({ ...payload, password: password }))}`)
    const response = await fetch('https://www.teetime.fi/backend/session', {
        method: 'POST',
        headers: standardRequestHeaders,
        body: JSON.stringify(payload)
    })
    const data = await response.json()
    return data.token
}

const roundToTenths = (num: number): number => Math.round(num * 10) / 10

const fetchPlayer = moize.maxAge(ms('10 minutes'))(async (token: string, clubNumber: string, firstName: string, lastName: string): Promise<TeetimePlayer|undefined> => {
    const url = ((): string => {
        const obj = new URL(`https://www.teetime.fi/backend/club/${encodeURIComponent(clubNumber)}/player/`)
        obj.searchParams.append('firstName', firstName)
        obj.searchParams.append('lastName', lastName)
        obj.searchParams.append('token', token)
        return obj.href
    })()
    const response = await fetch(url, {
        headers: standardRequestHeaders
    })
    if (response.ok) {
        try {
            const data = await response.json()
            if (data.length === 0) {
                return undefined
            }
            if (data.length > 1) {
                console.warn(`Expected exactly one player, but found ${data.length} players in ${clubNumber} by name of ${firstName} ${lastName}: ${JSON.stringify(data, null, 2)}`)
            }
            const player = data[0]
            const club = await fetchClub(player.club.number)
            return { ...player, club: club, holes: undefined, handicap: roundToTenths(player.handicap) || 0 } as TeetimePlayer
        } catch (err: any) {
            console.error(`Failed to fetch player ${firstName} ${lastName} from ${JSON.stringify(clubNumber)} at ${url}: ${err.message || err}`, err)
            return undefined
        }
    } else {
        if (response.status !== 404) {
            const statusText = (response.statusText && response.statusText !== `${response.status}`) ? ` ${response.statusText}` : ''
            console.warn(`Failed to fetch player at ${url} (HTTP ${response.status + statusText})`)
        }
        return undefined
    }
})

const fetchHandicap = async (token: string, clubNumber: string, firstName: string, lastName: string): Promise<number|undefined> => {
    const player = await fetchPlayer(token, clubNumber, firstName, lastName)
    if (player) {
        return player.handicap
    }
    return undefined
}

const ENV = import.meta.env || process.env || {}
const teetimeClubNumber = ENV.TEETIME_CLUB_NUMBER
const teetimeUsername = ENV.TEETIME_USERNAME
const teetimePassword = ENV.TEETIME_PASSWORD

if (!teetimeClubNumber || !teetimeUsername || !teetimePassword) {
    console.error(`Missing teetime.fi credentials:`)
    console.error(`TEETIME_CLUB_NUMBER: ${teetimeClubNumber ? teetimeClubNumber : '<MISSING>'}`)
    console.error(`TEETIME_USERNAME:   ${teetimeUsername ? teetimeUsername : '<MISSING>'}`)
    console.error(`TEETIME_PASSWORD:   ${teetimePassword ? teetimePassword.replace(/./g, '*') : '<MISSING>'}`)
    console.error(`Please try again and provide the missing environment variables.`)
    process.exit(1)
}
console.log(`teetimeClubNumber: ${teetimeClubNumber}`)
console.log(`teetimeUsername:   ${teetimeUsername}`)
console.log(`teetimePassword:   ${teetimePassword?.replace(/./g, '*')}`)

export type TeetimeSession = HandicapSource

export const createTeetimeSession = async (): Promise<TeetimeSession> => {
    const token = await login(teetimeClubNumber, teetimeUsername, teetimePassword)
    const _ = await fetchClubs() // pre-fetch clubs
    return {
        name: 'Teetime',
        getPlayerHandicap: async (firstName: string, lastName: string, clubNameOrAbbreviation: string): Promise<number|undefined> => {
            return await getTeetimePlayerHandicap(firstName, lastName, clubNameOrAbbreviation, token)
        },
        resolveClubMembership: async (firstName: string, lastName: string): Promise<string[]> => {
            return await findTeetimePlayerClubs(firstName, lastName, token)
        }
    }
}

const findTeetimePlayerClubs = async (firstName: string, lastName: string, token: string): Promise<string[]> => {
    const clubs = await fetchClubs()
    const clubAbbreviations: string[] = []
    for (let club of clubs) {
        const player = await fetchPlayer(token, club.number, firstName, lastName)
        if (player) {
            clubAbbreviations.push(club.abbrevitation)
        }
    }
    return Promise.resolve(clubAbbreviations)
}

const getTeetimePlayerHandicap = async (firstName: string, lastName: string, clubNameOrAbbreviation: string, providedToken?: string): Promise<number|undefined> => {
    if (clubNameOrAbbreviation) {
        if (!!teetimeClubNumber && !!teetimeUsername && !!teetimePassword) {
            const clubNumber = await resolveClubNumber(clubNameOrAbbreviation)
            if (clubNumber) {
                const token = providedToken || await login(teetimeClubNumber, teetimeUsername, teetimePassword)
                return await fetchHandicap(token, clubNumber, firstName, lastName)
            }
        }
    }
    return undefined
}

const resolveClubNumber = async (clubNameOrNumber: string): Promise<string|undefined> => {
    const club = await fetchClub(clubNameOrNumber)
    return club?.number
}

const fetchClub = async (clubNameOrNumber: string): Promise<TeetimeClub|undefined> => {
    if (!clubNameOrNumber) {
        console.warn(`No club name or number provided - cannot fetch club`)
        return undefined
    }
    const clubs = await fetchClubs()
    const club = clubs.find(club => {
        if (club.number && club.number === clubNameOrNumber) return true
        if (club.number && club.number.replace(/^0+/, '') === clubNameOrNumber.replace(/^0+/, '')) return true
        if (club.name && club.name.toLowerCase() === clubNameOrNumber.toLowerCase()) return true
        if (club.abbrevitation && club.abbrevitation.toLowerCase() === clubNameOrNumber.toLowerCase()) return true
        return false
    })
    if (club) {
        return club
    }
    return undefined
}
