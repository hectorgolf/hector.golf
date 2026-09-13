import { describe, expect, it, vi } from 'vitest'

import { createGitHubClient, FAILURE_MESSAGES, type GitHubFailure } from '../src/lib/github.ts'
import { DISPATCHABLE_WORKFLOWS, workflowBySlug } from '../src/lib/workflows.ts'

const handicaps = workflowBySlug('handicaps')!

/** A client whose fetch answers once, with whatever the test is about. */
function clientAnswering(response: Response) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    const client = createGitHubClient({
        repository: 'hectorgolf/hector.golf',
        token: async () => 'ghp_test',
        fetch,
    })
    return { client, fetch }
}

/** GitHub's answer to a dispatch it accepted: empty, with no run id in it. */
const accepted = () => new Response(null, { status: 204 })

const refused = (status: number, headers: Record<string, string> = {}) =>
    new Response('{"message":"..."}', { status, headers })

describe('dispatching a workflow', () => {
    it('asks GitHub to run the workflow file on main', async () => {
        const { client, fetch } = clientAnswering(accepted())

        expect(await client.dispatch(handicaps)).toEqual({ ok: true })

        const [url, init] = fetch.mock.calls[0]!
        expect(url).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-handicaps.yml/dispatches'
        )
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ ref: 'main' })
    })

    it('sends the headers GitHub requires, including a User-Agent and a pinned API version', async () => {
        const { client, fetch } = clientAnswering(accepted())
        await client.dispatch(handicaps)

        const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>
        expect(headers.authorization).toBe('Bearer ghp_test')
        expect(headers['user-agent']).toBeTruthy()
        expect(headers['x-github-api-version']).toBe('2022-11-28')
    })

    it('does not call GitHub at all when no token is configured', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(accepted())
        const client = createGitHubClient({
            repository: 'hectorgolf/hector.golf',
            token: async () => undefined,
            fetch,
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await client.dispatch(handicaps)).toEqual({ ok: false, reason: 'not-configured' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('asks for the token on every call, so a rotated secret is picked up without a redeploy', async () => {
        const token = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('ghp_test')
        const client = createGitHubClient({
            repository: 'hectorgolf/hector.golf',
            token,
            fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(accepted()),
        })

        await client.dispatch(handicaps)
        await client.dispatch(handicaps)

        expect(token).toHaveBeenCalledTimes(2)
    })
})

describe('classifying a refusal', () => {
    /*
     * These matter more than they look. A dispatch that silently fails is a
     * nightly update that silently stops, and the three cases below need three
     * different people to do three different things: rotate a token, fix a
     * workflow name, or simply wait.
     */
    const cases: Array<[string, Response, GitHubFailure]> = [
        ['an expired or wrong token', refused(401), 'unauthorized'],
        ['a token without the Actions permission', refused(403), 'unauthorized'],
        ['an exhausted rate limit, which also arrives as 403', refused(403, { 'x-ratelimit-remaining': '0' }), 'rate-limited'],
        ['an explicit 429', refused(429), 'rate-limited'],
        ['a workflow name that does not exist', refused(404), 'not-found'],
        ['GitHub having a bad day', refused(503), 'unavailable'],
        ['anything else', refused(418), 'unknown'],
    ]

    for (const [description, response, reason] of cases) {
        it(`reports ${description} as ${reason}`, async () => {
            const { client } = clientAnswering(response)
            vi.spyOn(console, 'error').mockImplementation(() => {})

            expect(await client.dispatch(handicaps)).toEqual({ ok: false, reason })
        })
    }

    it('treats a transport failure as GitHub being unreachable rather than crashing the request', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
        const client = createGitHubClient({
            repository: 'hectorgolf/hector.golf',
            token: async () => 'ghp_test',
            fetch,
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await client.dispatch(handicaps)).toEqual({ ok: false, reason: 'unavailable' })
    })

    it('has a message for every reason, so no failure reaches a person as a bare code', () => {
        const reasons: GitHubFailure[] = [
            'not-configured',
            'unauthorized',
            'not-found',
            'rate-limited',
            'unavailable',
            'unknown',
        ]
        for (const reason of reasons) {
            expect(FAILURE_MESSAGES[reason]).toBeTruthy()
        }
    })
})

describe('reading recent runs', () => {
    const runsResponse = (runs: unknown[]) =>
        new Response(JSON.stringify({ workflow_runs: runs }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })

    it('asks for the workflow that was requested, not the repository at large', async () => {
        const { client, fetch } = clientAnswering(runsResponse([]))
        await client.recentRuns(handicaps, 3)

        expect(String(fetch.mock.calls[0]![0])).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-handicaps.yml/runs?per_page=3'
        )
    })

    it('keeps only the fields the page renders', async () => {
        const { client } = clientAnswering(
            runsResponse([
                {
                    status: 'completed',
                    conclusion: 'success',
                    run_started_at: '2026-09-13T07:45:05Z',
                    event: 'schedule',
                    run_number: 1505,
                    html_url: 'https://github.com/hectorgolf/hector.golf/actions/runs/34745996205',
                    // Everything else GitHub sends, which is a lot, is dropped.
                    head_commit: { message: 'irrelevant' },
                },
            ])
        )

        const outcome = await client.recentRuns(handicaps)

        expect(outcome).toEqual({
            ok: true,
            runs: [
                {
                    status: 'completed',
                    conclusion: 'success',
                    startedAt: '2026-09-13T07:45:05Z',
                    event: 'schedule',
                    runNumber: 1505,
                    url: 'https://github.com/hectorgolf/hector.golf/actions/runs/34745996205',
                },
            ],
        })
    })

    it('degrades to a reason rather than throwing when the body is not the JSON it claims to be', async () => {
        // Otherwise this throws out of the page template and takes the buttons
        // down with the history they were displayed next to.
        const { client } = clientAnswering(
            new Response('<html>502 Bad Gateway</html>', {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        )
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await client.recentRuns(handicaps)).toEqual({ ok: false, reason: 'unknown' })
    })

    it('logs a refusal, so a page that says only "could not read" is not the whole story', async () => {
        const { client } = clientAnswering(refused(401))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

        await client.recentRuns(handicaps)

        expect(logged).toHaveBeenCalledWith(
            'GitHub refused a request',
            expect.objectContaining({ status: 401, reason: 'unauthorized' })
        )
    })

    it('survives a run that has never started, where run_started_at is absent', async () => {
        const { client } = clientAnswering(
            runsResponse([{ status: 'queued', conclusion: null, created_at: '2026-09-13T07:45:00Z' }])
        )

        const outcome = await client.recentRuns(handicaps)

        expect(outcome.ok).toBe(true)
        expect(outcome.ok && outcome.runs[0]).toMatchObject({
            status: 'queued',
            conclusion: null,
            startedAt: '2026-09-13T07:45:00Z',
        })
    })
})

describe('the list of workflows this service may start', () => {
    it('names files that exist in .github/workflows', async () => {
        // A typo here is a button that 404s at 03:00 rather than at review time,
        // and the workflow file is not something the type system can check.
        const { existsSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')

        for (const workflow of DISPATCHABLE_WORKFLOWS) {
            const path = fileURLToPath(new URL(`../../.github/workflows/${workflow.file}`, import.meta.url))
            expect(existsSync(path), `${workflow.file} is missing`).toBe(true)
        }
    })

    it('gives every workflow a unique slug, since the slug is the URL', () => {
        const slugs = DISPATCHABLE_WORKFLOWS.map((workflow) => workflow.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
    })

    it('only resolves slugs it knows, so a made-up URL cannot name a workflow', () => {
        expect(workflowBySlug('handicaps')?.file).toBe('update-handicaps.yml')
        expect(workflowBySlug('../../deploy')).toBeUndefined()
        expect(workflowBySlug(undefined)).toBeUndefined()
    })
})
