import { describe, expect, it, vi } from 'vitest'

import {
    createGitHubClient,
    EXPIRY_URGENT_DAYS,
    EXPIRY_WARN_DAYS,
    FAILURE_MESSAGES,
    parseTokenExpiry,
    type GitHubFailure,
} from '../src/lib/github.ts'
import { DISPATCHABLE_WORKFLOWS, SCHEDULED_WORKFLOWS, workflowBySlug } from '../src/lib/workflows.ts'

const leaderboards = workflowBySlug('leaderboards')!

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

        expect(await client.dispatch(leaderboards)).toEqual({ ok: true })

        const [url, init] = fetch.mock.calls[0]!
        expect(url).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-leaderboards.yml/dispatches'
        )
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ ref: 'main' })
    })

    it('sends the headers GitHub requires, including a User-Agent and a pinned API version', async () => {
        const { client, fetch } = clientAnswering(accepted())
        await client.dispatch(leaderboards)

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

        expect(await client.dispatch(leaderboards)).toEqual({ ok: false, reason: 'not-configured' })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('asks for the token on every call, so a rotated secret is picked up without a redeploy', async () => {
        const token = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('ghp_test')
        const client = createGitHubClient({
            repository: 'hectorgolf/hector.golf',
            token,
            fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(accepted()),
        })

        await client.dispatch(leaderboards)
        await client.dispatch(leaderboards)

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

            expect(await client.dispatch(leaderboards)).toEqual({ ok: false, reason })
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

        expect(await client.dispatch(leaderboards)).toEqual({ ok: false, reason: 'unavailable' })
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
        await client.recentRuns(leaderboards, 3)

        expect(String(fetch.mock.calls[0]![0])).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-leaderboards.yml/runs?per_page=3&page=1'
        )
    })

    it('asks inclusively for runs created since a moment, encoded so the operator survives', async () => {
        /*
         * `>=` rather than `>`, and it is not a nicety. The mirror sets this
         * window to a run's own timestamp when it is chasing an outcome it does
         * not know yet, and against the real API `>2026-09-18T17:52:52Z` returns
         * nothing where `>=` returns the run. The characters have to be encoded
         * or the query string eats them.
         */
        const { client, fetch } = clientAnswering(runsResponse([]))
        await client.recentRuns(leaderboards, 100, 1, new Date('2026-09-18T17:52:52.000Z'))

        expect(String(fetch.mock.calls[0]![0])).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-leaderboards.yml/runs' +
                '?per_page=100&page=1&created=%3E%3D2026-09-18T17%3A52%3A52.000Z'
        )
    })

    it('asks for the page it was given, which is how the mirror walks back through a history', async () => {
        // `lib/workflow-runs.ts` pages back the first time it meets a workflow.
        // Everything else takes the default and gets the newest page.
        const { client, fetch } = clientAnswering(runsResponse([]))
        await client.recentRuns(leaderboards, 100, 4)

        expect(String(fetch.mock.calls[0]![0])).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/actions/workflows/update-leaderboards.yml/runs?per_page=100&page=4'
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

        const outcome = await client.recentRuns(leaderboards)

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

        expect(await client.recentRuns(leaderboards)).toEqual({ ok: false, reason: 'unknown' })
    })

    it('logs a refusal, so a page that says only "could not read" is not the whole story', async () => {
        const { client } = clientAnswering(refused(401))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

        await client.recentRuns(leaderboards)

        expect(logged).toHaveBeenCalledWith(
            'GitHub refused a request',
            expect.objectContaining({ status: 401, reason: 'unauthorized' })
        )
    })

    it('survives a run that has never started, where run_started_at is absent', async () => {
        const { client } = clientAnswering(
            runsResponse([{ status: 'queued', conclusion: null, created_at: '2026-09-13T07:45:00Z' }])
        )

        const outcome = await client.recentRuns(leaderboards)

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
        expect(workflowBySlug('leaderboards')?.file).toBe('update-leaderboards.yml')
        expect(workflowBySlug('../../deploy')).toBeUndefined()
        expect(workflowBySlug(undefined)).toBeUndefined()
    })
})

describe('what the scheduled tick starts', () => {
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

    it('currently covers the three remaining scrapes and the deploy backstop, in the order they queue', () => {
        // The handicap scrape is deliberately not here: it runs in this process
        // as a job, and `SCHEDULED_JOBS` is the list it is on.
        expect(SCHEDULED_WORKFLOWS.map((workflow) => workflow.file)).toEqual([
            'update-leaderboards.yml',
            'update-player-biographies.yml',
            'update-player-club-memberships.yml',
            'deploy-site.yml',
        ])
    })

    it('is not empty, which would be a tick that does nothing four times a day', () => {
        expect(SCHEDULED_WORKFLOWS.length).toBeGreaterThan(0)
    })

    it('covers every workflow that used to carry a GitHub cron and still exists', () => {
        /*
         * The crons were deleted on 2026-09-16 and this tick became the only
         * clock, so a workflow missing from here is not "running on its own
         * schedule" any more — it is a scrape that has silently stopped, with
         * nothing red anywhere to say so. That is the failure this pins.
         *
         * `update-handicaps.yml` carried one too and is not listed, because it
         * no longer exists: that scrape runs in this process now. The test above
         * on `.github/workflows` is what would catch it being listed anyway.
         */
        expect(SCHEDULED_WORKFLOWS.map((workflow) => workflow.file).sort()).toEqual(
            [
                'deploy-site.yml',
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

        const result = await client.readFile('data/leaderboards/observations.ndjson')

        expect(result).toEqual({ ok: true, file: { present: true, text: 'one\ntwo\n', sha: 'blob-sha' } })
        const [url] = fetch.mock.calls[0]!
        expect(url).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/contents/data/leaderboards/observations.ndjson?ref=main'
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

describe('listing a directory', () => {
    const listing = (entries: Array<Record<string, unknown>>) =>
        new Response(JSON.stringify(entries), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })

    it('asks for the path on main and returns the files in it', async () => {
        const { client, fetch } = clientAnswering(
            listing([
                { name: 'HECTOR2026.json', path: 'astrosite/src/data/events/hector/HECTOR2026.json', type: 'file' },
                { name: 'HECTOR2025.json', path: 'astrosite/src/data/events/hector/HECTOR2025.json', type: 'file' },
            ])
        )

        const result = await client.listDirectory('astrosite/src/data/events/hector')

        // Sorted, so a caller's commit order does not depend on GitHub's.
        expect(result).toEqual({
            ok: true,
            files: [
                'astrosite/src/data/events/hector/HECTOR2025.json',
                'astrosite/src/data/events/hector/HECTOR2026.json',
            ],
        })
        const [url] = fetch.mock.calls[0]!
        expect(url).toBe(
            'https://api.github.com/repos/hectorgolf/hector.golf/contents/astrosite/src/data/events/hector?ref=main'
        )
    })

    it('leaves subdirectories out rather than walking them', async () => {
        const { client } = clientAnswering(
            listing([
                { name: 'hector', path: 'astrosite/src/data/events/hector', type: 'dir' },
                { name: 'README.md', path: 'astrosite/src/data/events/README.md', type: 'file' },
            ])
        )
        expect(await client.listDirectory('astrosite/src/data/events')).toEqual({
            ok: true,
            files: ['astrosite/src/data/events/README.md'],
        })
    })

    it('is empty for a directory with nothing in it, which is not the same as missing', async () => {
        const { client } = clientAnswering(listing([]))
        expect(await client.listDirectory('astrosite/src/data/events/hector')).toEqual({ ok: true, files: [] })
    })

    it('fails on a directory that is not there, where readFile would report absence', async () => {
        // The asymmetry is deliberate. A backup that does not exist yet is the
        // normal first run; a data directory that has vanished is not, and a
        // caller reading that as "no events" would recompute nothing and say it
        // succeeded.
        const { client } = clientAnswering(new Response('{"message":"Not Found"}', { status: 404 }))
        expect(await client.listDirectory('astrosite/src/data/events/nope')).toEqual({
            ok: false,
            reason: 'not-found',
        })
    })

    it('refuses a file, which GitHub answers as an object', async () => {
        // The mirror image of readFile refusing a directory, and refused for the
        // same reason: quietly returning nothing would read as an empty one.
        const { client } = clientAnswering(
            new Response(JSON.stringify({ content: 'eyJ9', encoding: 'base64', sha: 'x' }), { status: 200 })
        )
        expect(await client.listDirectory('astrosite/src/data/clubs.json')).toEqual({ ok: false, reason: 'unknown' })
    })

    it('refuses an entry with no path rather than inventing one', async () => {
        const { client } = clientAnswering(listing([{ name: 'HECTOR2026.json', type: 'file' }]))
        expect(await client.listDirectory('astrosite/src/data/events/hector')).toEqual({
            ok: false,
            reason: 'unknown',
        })
    })

    it('still classifies a refused listing', async () => {
        const { client } = clientAnswering(refused(401))
        expect(await client.listDirectory('anything')).toEqual({ ok: false, reason: 'unauthorized' })
    })
})

describe('committing a file', () => {
    const request = {
        path: 'data/leaderboards/observations.ndjson',
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


/**
 * The expiry is read off responses this service was making anyway, which is the
 * whole appeal — and also the thing to pin down, because a side channel is easy
 * to break without anything failing. Every way it can go wrong is silent: the
 * page simply stops warning, and looks exactly like a healthy token.
 */
describe("reading the token's expiry", () => {
    /** GitHub's own format, as observed on a real call: a space, and a zone name. */
    const header = (value: string) =>
        new Response('{}', { status: 200, headers: { 'github-authentication-token-expiration': value } })

    describe('parsing the header', () => {
        it("understands GitHub's format, which is not ISO 8601", () => {
            expect(parseTokenExpiry('2027-09-14 20:32:16 UTC')?.toISOString()).toBe('2027-09-14T20:32:16.000Z')
        })

        it('understands the shapes it might be written in instead', () => {
            for (const written of [
                '2027-09-14 20:32:16 +0000',
                '2027-09-14 20:32:16 +00:00',
                '2027-09-14T20:32:16Z',
                '  2027-09-14 20:32:16 utc  ',
            ]) {
                expect(parseTokenExpiry(written)?.toISOString(), written).toBe('2027-09-14T20:32:16.000Z')
            }
        })

        it('keeps an offset that is not UTC rather than assuming one', () => {
            expect(parseTokenExpiry('2027-09-14 20:32:16 +0300')?.toISOString()).toBe('2027-09-14T17:32:16.000Z')
        })

        /*
         * Silence, not a guess. Every one of these would otherwise become an
         * `Invalid Date` and a warning computed against `NaN` days — which is
         * worse than no warning, because it is a wrong one nobody can act on.
         */
        it('answers nothing for anything it does not recognise', () => {
            const unreadable = [undefined, null, '', '   ', 'never', 'tomorrow', '2027-09-14', 'not a date']
            for (const written of unreadable) {
                expect(parseTokenExpiry(written), String(written)).toBeUndefined()
            }
        })
    })

    describe('what the client remembers', () => {
        it('knows nothing until something has actually called GitHub', () => {
            const { client } = clientAnswering(accepted())
            expect(client.tokenExpiry()).toBeUndefined()
        })

        it('picks the date up from a call made for another reason entirely', async () => {
            const { client } = clientAnswering(header('2027-09-14 20:32:16 UTC'))
            await client.dispatch(leaderboards)

            const expiry = client.tokenExpiry(new Date('2027-08-15T20:32:16Z'))
            expect(expiry?.at.toISOString()).toBe('2027-09-14T20:32:16.000Z')
            expect(expiry?.daysLeft).toBe(30)
        })

        it('counts whole days, never reporting more time left than there is', async () => {
            const { client } = clientAnswering(header('2027-09-14 20:32:16 UTC'))
            await client.dispatch(leaderboards)

            // 6 days and 23 hours out. Reporting 7 would put this on the wrong
            // side of EXPIRY_URGENT_DAYS for an hour.
            expect(client.tokenExpiry(new Date('2027-09-07T21:32:16Z'))?.daysLeft).toBe(6)
        })

        it('goes negative once the date has passed rather than clamping at zero', async () => {
            const { client } = clientAnswering(header('2027-09-14 20:32:16 UTC'))
            await client.dispatch(leaderboards)

            expect(client.tokenExpiry(new Date('2027-09-17T20:32:16Z'))?.daysLeft).toBe(-3)
        })

        /*
         * The reason this truncates towards zero instead of rounding down.
         * Flooring a negative rounds *away* from zero, so a token one minute past
         * three days lapsed would be reported on the page as four days gone —
         * a heading inventing a day that has not happened.
         */
        it('does not age a lapse faster than the clock does', async () => {
            const { client } = clientAnswering(header('2027-09-14 20:32:16 UTC'))
            await client.dispatch(leaderboards)

            expect(client.tokenExpiry(new Date('2027-09-17T20:33:16Z'))?.daysLeft).toBe(-3)
        })

        /*
         * A refusal carries the header too, and a token close enough to expiry to
         * be worth warning about is a token whose calls may already be failing for
         * other reasons. Only reading it from successes would lose it exactly when
         * it is most worth having.
         */
        it('reads it from a refusal as readily as from a success', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {})
            const response = new Response('{"message":"..."}', {
                status: 503,
                headers: { 'github-authentication-token-expiration': '2027-09-14 20:32:16 UTC' },
            })
            const { client } = clientAnswering(response)

            expect(await client.dispatch(leaderboards)).toEqual({ ok: false, reason: 'unavailable' })
            expect(client.tokenExpiry(new Date('2027-09-14T20:32:16Z'))?.daysLeft).toBe(0)
        })

        /*
         * An expiry belongs to a token value, not to this service, so rotating
         * has to be able to clear one. These two are the whole reason the
         * remembered date is keyed by the token at all.
         *
         * The case that matters is rotation onto a token with *no* expiry — a
         * classic PAT — because that is the one where nothing later arrives to
         * correct the record. `githubToken()` deliberately does not cache, so a
         * new secret version takes effect on the next call and this is reached
         * without a redeploy.
         */
        it('drops a date learned from a token that is no longer the one in use', async () => {
            let token = 'ghp_first'
            const fetch = vi
                .fn<typeof globalThis.fetch>()
                .mockResolvedValueOnce(header('2027-09-14 20:32:16 UTC'))
                // The rotation: a classic token, which reports no expiry at all.
                .mockResolvedValueOnce(accepted())
            const client = createGitHubClient({
                repository: 'hectorgolf/hector.golf',
                token: async () => token,
                fetch,
            })

            await client.dispatch(leaderboards)
            expect(client.tokenExpiry(new Date('2027-08-15T20:32:16Z'))?.daysLeft).toBe(30)

            token = 'ghp_second'
            await client.dispatch(leaderboards)
            expect(client.tokenExpiry(new Date('2027-08-15T20:32:16Z'))).toBeUndefined()
        })

        it('takes the new token at its word when it reports an expiry of its own', async () => {
            let token = 'ghp_first'
            const fetch = vi
                .fn<typeof globalThis.fetch>()
                .mockResolvedValueOnce(header('2027-09-14 20:32:16 UTC'))
                .mockResolvedValueOnce(header('2028-03-01 09:00:00 UTC'))
            const client = createGitHubClient({
                repository: 'hectorgolf/hector.golf',
                token: async () => token,
                fetch,
            })

            await client.dispatch(leaderboards)
            token = 'ghp_second'
            await client.dispatch(leaderboards)

            expect(client.tokenExpiry()?.at.toISOString()).toBe('2028-03-01T09:00:00.000Z')
        })

        /*
         * Not every answer repeats it, so for the token we already know an absent
         * header has to mean "nothing new" rather than "no expiry" — an edge, a
         * proxy, or the 401 from a token that has just lapsed. Forgetting there
         * would blank the notice on a blip. This is the other side of the two
         * tests above: silence from a *known* token is not an answer, silence
         * from a new one is.
         */
        it('keeps what it knows when a later answer from the same token says nothing about it', async () => {
            const fetch = vi
                .fn<typeof globalThis.fetch>()
                .mockResolvedValueOnce(header('2027-09-14 20:32:16 UTC'))
                .mockResolvedValueOnce(accepted())
            const client = createGitHubClient({
                repository: 'hectorgolf/hector.golf',
                token: async () => 'ghp_test',
                fetch,
            })

            await client.dispatch(leaderboards)
            await client.dispatch(leaderboards)

            expect(client.tokenExpiry(new Date('2027-08-15T20:32:16Z'))?.daysLeft).toBe(30)
        })
    })

    it('warns well before it insists, and both before the token lapses', () => {
        expect(EXPIRY_WARN_DAYS).toBeGreaterThan(EXPIRY_URGENT_DAYS)
        expect(EXPIRY_URGENT_DAYS).toBeGreaterThan(0)
    })

    /*
     * The playbook tells somebody creating a token how long they will be warned
     * for, and prose cannot import a constant. `GitHubTokenHelp` interpolates
     * this one so the page cannot drift; the Markdown restates it by hand, which
     * is precisely the arrangement that made the permissions table in that same
     * file wrong for two days. Cheaper to pin it than to notice it again.
     */
    it('is the number the bootstrapping playbook promises, which cannot import it', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')

        const playbook = fileURLToPath(new URL('../../docs/playbooks/gcp-bootstrapping.md', import.meta.url))
        const text = readFileSync(playbook, 'utf-8')

        expect(text, 'the playbook should say how long /operations warns for').toContain(
            `warns for the last ${EXPIRY_WARN_DAYS} days`
        )
    })
})
