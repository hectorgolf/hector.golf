import { Octokit, RequestError } from 'octokit'
import type { GoogleSheetIndividualLeaderboard, GoogleSheetTeamLeaderboard } from './types'

const standardOptions = {
    owner: 'hectorgolf',
    repo: 'hector.golf',
    headers: {
        'X-GitHub-Api-Version': '2022-11-28'
    }
}

const authenticate = async (githubToken: string): Promise<Octokit> => {
  return Promise.resolve(new Octokit({ auth: githubToken }))
}

const fetchExistingHectorLeaderboardDataFile = async (githubToken: string, eventId: string): Promise<{sha:string, json: any}|undefined> => {
    try {
        const octokit = await authenticate(githubToken)
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            ...standardOptions,
            path: `astrosite/src/data/leaderboards/${eventId}.json`
        })
        const sha = (response.data as any).sha as string|undefined
        const content = (response.data as any).content as string|undefined
        const json = content ? JSON.parse(Buffer.from(content, 'base64').toString('utf-8')) : {}
        if (sha && json) {
            return { sha, json }
        }
    } catch (err: any) {
        // HTTP 404 is expected if the file doesn't exist yet but let's log all other errors!
        if ((err as RequestError).status !== 404) {
            console.error(`Failed to fetch existing leaderboard data file for event ${eventId}`, err)
        }
    }
    return undefined
}

const createOrReplaceHectorLeaderboardDataFile = async (githubToken: string, eventId: string, existingSHA: string|undefined, hector: GoogleSheetTeamLeaderboard, victor: GoogleSheetIndividualLeaderboard) => {
    const payload = {
        event: eventId,
        hector: hector,
        victor: victor,
        updatedAt: new Date().toISOString()
    }
    const fileContents = JSON.stringify(payload, null, 2)
    const fileContentsBase64 = Buffer.from(fileContents).toString('base64')
    const octokit = await authenticate(githubToken)
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        ...standardOptions,
        path: `astrosite/src/data/leaderboards/${eventId}.json`,
        message: `Automated leaderboard update for ${eventId} at ${payload.updatedAt}`,
        committer: {
            name: 'UpdateHectorLeaderboard',
            email: 'lasse.koskela@gmail.com'
        },
        sha: existingSHA,
        content: fileContentsBase64
    })
}

export const updateHectorEventLeaderboard = async (githubToken: string, eventId: string, hector: GoogleSheetTeamLeaderboard, victor: GoogleSheetIndividualLeaderboard) => {
    const existingFile = await fetchExistingHectorLeaderboardDataFile(githubToken, eventId)
    const sha = existingFile?.sha
    if (areDeeplyEqual(existingFile?.json.hector, hector) && areDeeplyEqual(existingFile?.json.victor, victor)) {
        console.log(`Leaderboard data for event ${eventId} hasn't changed; skipping the update for event ${eventId}`)
        console.log(`Hector: ${JSON.stringify(hector, null, 2)}`)
        console.log(`Victor: ${JSON.stringify(victor, null, 2)}`)
    } else if (sha === undefined) {
        console.log(`Creating a new leaderboard data file for event ${eventId}`)
        createOrReplaceHectorLeaderboardDataFile(githubToken, eventId, undefined, hector, victor)
    } else {
        console.log(`Leaderboard data for event ${eventId} has changed; updating leaderboard data for event ${eventId}`)
        createOrReplaceHectorLeaderboardDataFile(githubToken, eventId, sha, hector, victor)
    }
}

function areDeeplyEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;

    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) return false;
        return obj1.every((elem, index) => {
            return areDeeplyEqual(elem, obj2[index]);
        })
    }

    if (typeof obj1 === "object" && typeof obj2 === "object" && obj1 !== null && obj2 !== null) {
        if (Array.isArray(obj1) || Array.isArray(obj2)) return false;
        const keys1 = Object.keys(obj1)
        const keys2 = Object.keys(obj2)
        if (keys1.length !== keys2.length || !keys1.every(key => keys2.includes(key))) return false;
        for(let key in obj1) {
            let isEqual = areDeeplyEqual(obj1[key], obj2[key])
            if (!isEqual) { return false; }
        }
        return true;
    }

    return false;
}