import { Octokit } from 'octokit'
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

export const updateHectorEventLeaderboard = async (githubToken: string, eventId: string, hector: TeamLeaderboard, victor: IndividualLeaderboard) => {
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
        content: fileContentsBase64
    })
}
