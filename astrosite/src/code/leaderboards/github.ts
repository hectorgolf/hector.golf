import { Octokit, RequestError } from 'octokit'
import type { IndividualLeaderboard, TeamLeaderboard } from './types'

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

const fetchExistingHectorLeaderboardDataFileSHA = async (githubToken: string, eventId: string): Promise<string|undefined> => {
    try {
        const octokit = await authenticate(githubToken)
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            ...standardOptions,
            path: `astrosite/src/data/leaderboards/${eventId}.json`
        })
        return (response.data as any).sha as string|undefined
    } catch (err: any) {
        // HTTP 404 is expected if the file doesn't exist yet but let's log all other errors!
        if ((err as RequestError).status !== 404) {
            console.error(`Failed to fetch existing leaderboard data file for event ${eventId}`, err)
        }
        return undefined
    }
}

const createOrReplaceHectorLeaderboardDataFile = async (githubToken: string, eventId: string, existingSHA: string|undefined, hector: TeamLeaderboard, victor: IndividualLeaderboard) => {
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
        message: 'Automated leaderboard update',
        committer: {
            name: 'UpdateHectorLeaderboard',
            email: 'lasse.koskela@gmail.com'
        },
        sha: existingSHA,
        content: fileContentsBase64
    })
}

export const updateHectorEventLeaderboard = async (githubToken: string, eventId: string, hector: TeamLeaderboard, victor: IndividualLeaderboard) => {
    const existingSHA = await fetchExistingHectorLeaderboardDataFileSHA(githubToken, eventId)
    createOrReplaceHectorLeaderboardDataFile(githubToken, eventId, existingSHA, hector, victor)
}
