import moize from 'moize'
import { ms } from 'itty-time'
import { pRateLimit } from 'p-ratelimit'

import { type HandicapSource } from './handicap-source-api'

export type WisegolfSession = HandicapSource

export type WisegolfClub = {
    name: string,
    number: string,
    abbreviation: string,
    softwareVendorName?: string,
}

export type WisegolfPlayer = {
    clubMemberId: string,  // "memberNO" in Wisegolf JSON
    firstName: string,
    lastName: string,      // "familyName" in Wisegolf JSON
    club: WisegolfClub,    // "clubId" in Wisegolf JSON
    handicap: number       // "handicapActive" in Wisegolf JSON
}


const ENV = import.meta.env || process.env || {}
const wisegolfUsername = ENV.WISEGOLF_USERNAME
const wisegolfPassword = ENV.WISEGOLF_PASSWORD

if (!wisegolfUsername || !wisegolfPassword) {
    console.error(`Missing wisegolfclub.fi credentials:`)
    console.error(`WISEGOLF_USERNAME:   ${wisegolfUsername ? wisegolfUsername : '<MISSING>'}`)
    console.error(`WISEGOLF_PASSWORD:   ${wisegolfPassword ? wisegolfPassword.replace(/./g, '*') : '<MISSING>'}`)
    console.error(`Please try again and provide the missing environment variables.`)
    process.exit(1)
}
console.log(`wisegolfUsername:   ${wisegolfUsername}`)
console.log(`wisegolfPassword:   ${wisegolfPassword?.replace(/./g, '*')}`)


/*
    curl 'https://api.wisegolfclub.fi/api/1.0/auth' \
        -X 'POST' \
        -H 'Content-Type: application/json' \
        -H 'Pragma: no-cache' \
        -H 'Accept: application/json' \
        -H 'Accept-Language: en-GB,en;q=0.9' \
        -H 'Sec-Fetch-Dest: empty' \
        -H 'Sec-Fetch-Mode: cors' \
        -H 'Sec-Fetch-Site: cross-site' \
        -H 'Origin: https://app.wisegolf.fi' \
        -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15' \
        -H 'Referer: https://app.wisegolf.fi/' \
        -H 'Cache-Control: no-cache' \
        -H 'Connection: keep-alive' \
        -H 'Host: api.wisegolfclub.fi' \
        -H 'x-session-type: wisegolf' \
        -H 'Content-Length: 98' \
        --data-binary '{"username":"lasse.koskela@gmail.com","password":"VMpaskaa!","appId":"affbfa03","version":"2.7.0"}'
*/

const standardRequestHeaders = {
    'Accept': 'application/json',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'application/json',
    'Origin': 'https://app.wisegolf.fi',
    'Pragma': 'no-cache',
    'Referer': 'https://app.wisegolf.fi/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'x-session-type': 'wisegolf',
}

const fetchClubs = moize.maxAge(ms('1 hour'))(async (token: string): Promise<Array<WisegolfClub>> => {
    const url = 'https://api.wisegolfclub.fi/api/1.0/golf/club/'
    console.log(`Fetching clubs from ${url}`)
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Authorization': `token ${token}`
        }
    })
    if (response.ok) {
        const data = await response.json()
        const clubs =  (data.rows || [])
            .map((club:any) => ({
                    name: club.name,
                    number: club.clubId,
                    abbreviation: club.abbreviation,
                    softwareVendorName: club.softwareVendorName
                }) as WisegolfClub
            ).sort((a: WisegolfClub, b: WisegolfClub) => a.name.localeCompare(b.name))
        console.log(`Got ${clubs.length} clubs from ${url}`)
        return clubs
    } else {
        return Promise.reject(`Failed to fetch clubs from ${url} (HTTP ${response.status})`)
    }
})

export const createWisegolfSession = async (): Promise<WisegolfSession> => {
    const token = await login(wisegolfUsername, wisegolfPassword)
    const _ = await fetchClubs(token) // pre-fetch clubs
    return {
        name: 'WiseGolf',
        getPlayerHandicap: async (firstName: string, lastName: string, clubNameOrAbbreviation: string): Promise<number|undefined> => {
            return await getWisegolfPlayerHandicap(firstName, lastName, clubNameOrAbbreviation, token)
        },
        resolveClubMembership: async (firstName: string, lastName: string): Promise<string[]> => {
            return await findWisegolfPlayerClubs(firstName, lastName, token)
        }
    }
}

const findWisegolfPlayerClubs = async (firstName: string, lastName: string, token: string): Promise<string[]> => {
    const clubs = await fetchClubs(token)
    const clubAbbreviations: string[] = []
    for (let club of clubs) {
        const player = await fetchPlayer(token, club.number, firstName, lastName)
        if (player) {
            clubAbbreviations.push(club.abbreviation)
        }
    }
    return Promise.resolve(clubAbbreviations)
}


const sanitizePassword = (obj: any): any => {
    if ('password' in obj) {
        return { ...obj, password: obj.password.replace(/./g, '*') }
    }
    return obj
}

const login = async (username: string, password: string): Promise<string> => {
    const payload = {
        username: username,
        password: password,
        appId: "affbfa03",
        version: "2.7.0"
    }
    console.log(`Logging in to WiseGolf with ${JSON.stringify(sanitizePassword(payload))}`)
    const response = await fetch('https://api.wisegolfclub.fi/api/1.0/auth', {
        method: 'POST',
        headers: standardRequestHeaders,
        body: JSON.stringify(payload)
    })
    const data = await response.json()
    return data.access_token
}

const roundToTenths = (num: number): number => Math.round(num * 10) / 10


const fetchPlayerRateLimiter = pRateLimit({
    interval: 1000,
    rate: 5,
    concurrency: 1
})

const fetchPlayer = moize.maxAge(ms('10 minutes'))(async (token: string, clubNumber: string, firstName: string, lastName: string): Promise<WisegolfPlayer|undefined> => {
    const url = ((): string => {
        const obj = new URL(`https://api.ringsidegolf.fi/api/1.0/golf/player/`)
        obj.searchParams.append('firstname', firstName)
        obj.searchParams.append('familyname', lastName)
        obj.searchParams.append('clubid', clubNumber)
        obj.searchParams.append('memberno', '')
        return obj.href
    })()
    const response = await fetchPlayerRateLimiter(() => fetch(url, {
        headers: { ...standardRequestHeaders, authorization: `token ${token}` }
    }))
    if (response.ok) {
        try {
            const data = await response.json()
            if (data?.rows?.length === 0) {
                return undefined
            }
            if (data.rows.length > 1) {
                console.warn(`Expected exactly one player, but found ${data.length} players in ${clubNumber} by name of ${firstName} ${lastName}: ${JSON.stringify(data, null, 2)}`)
            }
            const player = data.rows[0]
            const club = await fetchClub(player.clubId, token)
            return {
                firstName: player.firstName,
                lastName: player.familyName,
                club: club,
                clubMemberId: player.memberNO,
                handicap: roundToTenths(player.handicapActive) || 0
            } as WisegolfPlayer
        } catch (err: any) {
            console.error(`Failed to fetch player ${firstName} ${lastName} from ${JSON.stringify(clubNumber)} at ${url}: ${err.message || err}`, err)
            return undefined
        }
    } else {
        const statusText = (response.statusText && response.statusText !== `${response.status}`) ? ` ${response.statusText}` : ''
        console.warn(`Failed to fetch player at ${url} (HTTP ${response.status + statusText})`)
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


const resolveClubNumber = async (clubNameOrNumber: string, token: string): Promise<string|undefined> => {
    const club = await fetchClub(clubNameOrNumber, token)
    return club?.number
}

const fetchClub = async (clubNameOrNumber: string, token: string): Promise<WisegolfClub|undefined> => {
    if (!clubNameOrNumber) {
        console.warn(`No club name or number provided - cannot fetch club`)
        return undefined
    }
    const clubs = await fetchClubs(token)
    const club = clubs.find(club => {
        if (club.number && club.number === clubNameOrNumber) return true
        if (club.number && club.number.replace(/^0+/, '') === clubNameOrNumber.replace(/^0+/, '')) return true
        if (club.name && club.name.toLowerCase() === clubNameOrNumber.toLowerCase()) return true
        if (club.abbreviation && club.abbreviation.toLowerCase() === clubNameOrNumber.toLowerCase()) return true
        return false
    })
    if (club) {
        return club
    }
    return undefined
}

// export const withLogin = async (callback: (token: string) => Promise<void>): Promise<void> => {
//     return new Promise((resolve, reject) => {
//         login(wisegolfUsername, wisegolfPassword).then(token => {
//             callback(token).then(resolve).catch(reject)
//         })
//     })
// }

const getWisegolfPlayerHandicap = async (firstName: string, lastName: string, clubNameOrAbbreviation: string, providedToken?: string): Promise<number|undefined> => {
    if (clubNameOrAbbreviation) {
        if (!!wisegolfUsername && !!wisegolfPassword) {
            const token = providedToken || await login(wisegolfUsername, wisegolfPassword)
            const clubNumber = await resolveClubNumber(clubNameOrAbbreviation, token)
            if (clubNumber) {
                return await fetchHandicap(token, clubNumber, firstName, lastName)
            }
        }
    }
    return undefined
}
