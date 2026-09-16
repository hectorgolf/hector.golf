import { describe, expect, it, vi } from 'vitest'

import { createGitHubClient, FAILURE_MESSAGES, type GitHubFailure } from '../src/lib/github.ts'
import { DISPATCHABLE_WORKFLOWS, SCHEDULED_WORKFLOWS, workflowBySlug } from '../src/lib/workflows.ts'

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

describe('what the twice-daily tick starts', () => {
    /*
     * The two Cloud Scheduler jobs call one endpoint that starts this list, so
     * this list *is* the schedule's payload — the infrastructure names no
     * workflow at all. An entry silently dropping out of it would be a scrape
     * that quietly stops running, with the jobs still green.
     */
    it('is every workflow the tick considers, and only those', () => {
        expect(SCHEDULED_WORKFLOWS.map((workflow) => workflow.slug)).toEqual(
            DISPATCHABLE_WORKFLOWS.filter((workflow) => workflow.cadence !== 'manual').map((workflow) => workflow.slug)
        )
        expect(SCHEDULED_WORKFLOWS.every((workflow) => workflow.cadence !== 'manual')).toBe(true)
    })

    it('currently covers all four scrapes and the deploy backstop, in the order they queue', () => {
        expect(SCHEDULED_WORKFLOWS.map((workflow) => workflow.file)).toEqual([
            'update-handicaps.yml',
            'update-leaderboards.yml',
            'update-player-biographies.yml',
            'update-player-club-memberships.yml',
            'deploy-site.yml',
        ])
    })

    it('is not empty, which would be a tick that does nothing four times a day', () => {
        expect(SCHEDULED_WORKFLOWS.length).toBeGreaterThan(0)
    })

    it('covers every workflow that used to carry a GitHub cron', () => {
        /*
         * The crons were deleted on 2026-09-16 and this tick became the only
         * clock, so a workflow missing from here is not "running on its own
         * schedule" any more — it is a scrape that has silently stopped, with
         * nothing red anywhere to say so. That is the failure this pins.
         */
        expect(SCHEDULED_WORKFLOWS.map((workflow) => workflow.file).sort()).toEqual(
            [
                'deploy-site.yml',
                'update-handicaps.yml',
                'update-leaderboards.yml',
                'update-player-biographies.yml',
                'update-player-club-memberships.yml',
            ].sort()
        )
    })
})

/**
 * Reading and writing the one file this service commits.
 *
 * The backup is rendered from Firestore and committed through the contents API,
 * which means two statuses matter that a dispatch never sees: a 404, which is
 * the first run rather than a problem, and a 409, which is having lost a race
 * with one of the four workflows that also push to `main`.
 */

const fileResponse = (text: string, sha = 'blob-sha') =>
    new Response(
        JSON.stringify({ content: Buffer.from(text, 'utf-8').toString('base64'), encoding: 'base64', sha }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    )

describe('reading a file', () => {
    it('asks for the path on main and decodes what comes back', async () => {
        const { client, fetch } = clientAnswering(fileResponse('one\ntwo\n'))

        const result = await client.readFile('astrosite/src/data/handicaps.ndjson')

        expect(result).toEqual({ ok: true, file: { present: true, text: 'one\ntwo\n', sha: 'blob-sha' } })
        const [url] = fetch.mock.calls[0]!
        expect(url).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/contents/astrosite/src/data/handicaps.ndjson?ref=main'
        )
    })

    it('reports a missing file as absent rather than as a failure', async () => {
        // The first run, before the backup exists. The caller creates it by
        // committing with no sha.
        const { client } = clientAnswering(new Response('{"message":"Not Found"}', { status: 404 }))
        expect(await client.readFile('nope.ndjson')).toEqual({ ok: true, file: { present: false } })
    })

    it('refuses to treat a file too large for this API as an empty one', async () => {
        // GitHub answers a file over 1MB with `encoding: "none"` and no content.
        // Reporting that as empty text would hand the append-only guard exactly
        // the input it exists to refuse, and it would refuse it — but the honest
        // answer is that the read failed.
        const { client } = clientAnswering(
            new Response(JSON.stringify({ content: '', encoding: 'none', sha: 'x' }), { status: 200 })
        )
        expect(await client.readFile('huge.ndjson')).toEqual({ ok: false, reason: 'unknown' })
    })

    it('refuses a directory, which GitHub answers as an array', async () => {
        const { client } = clientAnswering(new Response(JSON.stringify([{ name: 'a.json' }]), { status: 200 }))
        expect(await client.readFile('astrosite/src/data')).toEqual({ ok: false, reason: 'unknown' })
    })

    it('still classifies a refused read', async () => {
        const { client } = clientAnswering(refused(401))
        expect(await client.readFile('anything')).toEqual({ ok: false, reason: 'unauthorized' })
    })
})

describe('committing a file', () => {
    const request = {
        path: 'astrosite/src/data/handicaps.ndjson',
        text: 'one\ntwo\n',
        message: "Update 1 player's handicap",
        sha: 'blob-sha',
        committer: { name: 'hector-admin', email: 'bot@hector.golf' },
    }

    const committed = (sha = 'commit-sha') =>
        new Response(JSON.stringify({ commit: { sha } }), { status: 200 })

    it('PUTs base64 content to the branch, quoting the sha it is replacing', async () => {
        const { client, fetch } = clientAnswering(committed())

        expect(await client.commitFile(request)).toEqual({ ok: true, commit: 'commit-sha' })

        const [, init] = fetch.mock.calls[0]!
        const body = JSON.parse(String(init?.body))
        expect(init?.method).toBe('PUT')
        expect(body.branch).toBe('main')
        expect(body.sha).toBe('blob-sha')
        expect(Buffer.from(body.content, 'base64').toString('utf-8')).toBe('one\ntwo\n')
    })

    it('omits the sha entirely when creating a file, because GitHub rejects a null', async () => {
        const { client, fetch } = clientAnswering(committed())
        await client.commitFile({ ...request, sha: undefined })
        expect(Object.keys(JSON.parse(String(fetch.mock.calls[0]![1]?.body)))).not.toContain('sha')
    })

    it('attributes the commit to the service rather than to whoever owns the token', async () => {
        const { client, fetch } = clientAnswering(committed())
        await client.commitFile(request)
        const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
        expect(body.author).toEqual(request.committer)
        expect(body.committer).toEqual(request.committer)
    })

    it('reports a lost race as a conflict, which the caller retries', async () => {
        const { client } = clientAnswering(new Response('{"message":"is at ..."}', { status: 409 }))
        expect(await client.commitFile(request)).toEqual({ ok: false, reason: 'conflict' })
    })

    it('reports a commit that landed but answered unreadably as success', async () => {
        // The commit is made. Saying otherwise would send the caller into a
        // retry that re-reads, finds its own work committed, and does nothing —
        // which is harmless but reports a failure that did not happen.
        const { client } = clientAnswering(new Response('not json', { status: 201 }))
        expect(await client.commitFile(request)).toEqual({ ok: true, commit: 'unknown' })
    })

    it('classifies a refused commit like any other call', async () => {
        const { client } = clientAnswering(refused(403))
        expect(await client.commitFile(request)).toEqual({ ok: false, reason: 'unauthorized' })
    })
})
