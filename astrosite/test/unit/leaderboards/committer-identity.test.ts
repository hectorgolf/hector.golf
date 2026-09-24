import { expect, describe, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * A missing GIT_COMMITTER_EMAIL must not stop a live tournament updating.
 *
 * It did, on 2026-09-24. The workflow passed the address to its "Commit changes"
 * step but not to the step that runs this code, and the module threw rather than
 * falling back — so the run died before writing anything. The gap had been there
 * for as long as the variable had, and stayed invisible because the GitHub API
 * call only happens for an *ongoing* tournament: the first run of Hector Trophée
 * 2026 was the first run ever to reach it.
 *
 * That is the shape worth locking in, rather than the address itself. Attribution
 * is the least important thing this file does; the leaderboard is still correct
 * when the commit is signed by the wrong address, and unreachable when the run
 * dies.
 *
 * `COMMITTER` is not exported and is read at module scope, so the module is
 * re-imported under a stubbed environment and observed through the API call it
 * makes.
 */

const captured: any[] = []

vi.mock('octokit', () => {
    class Octokit {
        rest = {
            repos: {
                // 404 puts us on the "create a new file" path, which is the one the
                // live tournament took.
                getContent: async () => {
                    throw Object.assign(new Error('Not Found'), { status: 404 })
                },
                createOrUpdateFileContents: async (options: any) => {
                    captured.push(options)
                    return { data: { content: { url: 'https://example.invalid/file' } } }
                },
            },
        }
    }
    class RequestError extends Error {}
    return { Octokit, RequestError }
})

const committerUnder = async (email: string | undefined): Promise<{ name: string; email: string }> => {
    captured.length = 0
    vi.resetModules()
    if (email === undefined) {
        vi.stubEnv('GIT_COMMITTER_EMAIL', '')
    } else {
        vi.stubEnv('GIT_COMMITTER_EMAIL', email)
    }
    const { updateHectorEventLeaderboard } = await import('../../../src/code/leaderboards/github')
    await updateHectorEventLeaderboard('a-token', 'HECTOR2026', {} as any, {} as any)
    return captured[0].committer
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('the leaderboard commit committer', () => {
    it('uses GIT_COMMITTER_EMAIL when it is set', async () => {
        const committer = await committerUnder('someone@example.com')

        expect(committer.email).toBe('someone@example.com')
    })

    it('still writes the leaderboard when GIT_COMMITTER_EMAIL is unset', async () => {
        const committer = await committerUnder(undefined)

        expect(committer.email).toBe('noreply@hector.golf')
    })

    it('names the workflow that wrote it, so git log keeps answering "what wrote this"', async () => {
        const committer = await committerUnder('someone@example.com')

        expect(committer.name).toBe('UpdateHectorLeaderboard')
    })
})
