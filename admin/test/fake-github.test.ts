import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiBaseUrl, createGitHubClient, GITHUB_API, type GitHubClient } from '../src/lib/github.ts'
import { DISPATCHABLE_WORKFLOWS, workflowBySlug } from '../src/lib/workflows.ts'
import { createServer, emptyState, seedHistory, type FakeState } from '../scripts/fake-github.ts'

/**
 * The base URL is the one piece of configuration in this service that is also an
 * instruction to send a credential somewhere: `headers()` puts the dispatch
 * token in an `Authorization` header on every call, so whatever it resolves to
 * is handed something that can push to the repository.
 *
 * Which makes these the tests that matter more than the stand-in's own. A fake
 * that answers wrongly wastes an afternoon; an override that accepts a host
 * somebody else controls posts the token to them.
 */
describe('where GitHub is', () => {
    it('is GitHub, when nothing says otherwise', () => {
        expect(apiBaseUrl({})).toBe(GITHUB_API)
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: '' })).toBe(GITHUB_API)
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: '   ' })).toBe(GITHUB_API)
    })

    it('accepts a loopback stand-in, by name or by address', () => {
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: 'http://127.0.0.1:8433' })).toBe('http://127.0.0.1:8433')
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: 'http://localhost:8433' })).toBe('http://localhost:8433')
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: 'http://[::1]:8433' })).toBe('http://[::1]:8433')
    })

    it('refuses any host that is not this machine', () => {
        for (const host of [
            'https://api.github.com.evil.example',
            'https://evil.example',
            'http://192.168.1.10:8433',
            'http://169.254.169.254',
            'https://localhost.evil.example',
        ]) {
            expect(() => apiBaseUrl({ GITHUB_API_BASE_URL: host })).toThrow(/only point at this machine/)
        }
    })

    /**
     * The tempting behaviour, and the dangerous one. Somebody who set this
     * variable did it to stop talking to GitHub; resolving their typo into "real
     * GitHub, then" means the next button press dispatches a real workflow with a
     * real token while they believe it went to a stub.
     */
    it('throws rather than quietly falling back to the real thing', () => {
        expect(() => apiBaseUrl({ GITHUB_API_BASE_URL: 'https://evil.example' })).toThrow()
        expect(() => apiBaseUrl({ GITHUB_API_BASE_URL: 'not a url' })).toThrow(/not a URL/)
        expect(() => apiBaseUrl({ GITHUB_API_BASE_URL: 'file:///etc/passwd' })).toThrow(/http or https/)
    })

    it('refuses credentials in the URL, which would be sent on every call', () => {
        expect(() => apiBaseUrl({ GITHUB_API_BASE_URL: 'http://user:pass@localhost:8433' })).toThrow(/username/)
    })

    it('trims a trailing slash, which would otherwise double up in every path', () => {
        expect(apiBaseUrl({ GITHUB_API_BASE_URL: 'http://localhost:8433/' })).toBe('http://localhost:8433')
    })
})

/**
 * The stand-in, driven through the **real** client rather than through
 * assertions about its JSON.
 *
 * That is the whole design of these: a fake is only worth having if the code
 * that will meet it can read what it says, and a test written against the same
 * assumptions that produced the fake would agree with it while both were wrong.
 * `createGitHubClient` parses base64 with an `encoding` field, expects a blob
 * sha, reads `run_started_at`, and treats 404 and 409 specially — so pointing it
 * at the stand-in exercises every one of those.
 */
describe('the stand-in, as the client sees it', () => {
    const repository = 'hectorgolf/hector.golf'
    const handicaps = workflowBySlug('handicaps')!

    let server: Server
    let client: GitHubClient
    let state: FakeState
    /** For the one case the client cannot express: a filter it would never build. */
    let base: string

    beforeAll(async () => {
        state = emptyState()
        seedHistory(
            state,
            DISPATCHABLE_WORKFLOWS.map((workflow) => workflow.file)
        )
        server = createServer(state, repository)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const { port } = server.address() as AddressInfo
        base = `http://127.0.0.1:${port}`
        client = createGitHubClient({
            repository,
            token: async () => 'fake-token',
            baseUrl: `http://127.0.0.1:${port}`,
        })
    })

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    it('has a history before anything is pressed, which is what the log is for', async () => {
        const outcome = await client.recentRuns(handicaps, 10)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.runs.length).toBeGreaterThan(0)
        // Newest first, the order the page renders without re-sorting.
        expect(outcome.runs[0]!.startedAt >= outcome.runs[1]!.startedAt).toBe(true)
        expect(outcome.runs[0]!.status).toBe('completed')
    })

    it('accepts a dispatch and then has a run to show for it', async () => {
        const before = await client.recentRuns(handicaps, 10)
        expect(await client.dispatch(handicaps)).toEqual({ ok: true })
        const after = await client.recentRuns(handicaps, 10)

        expect(before.ok && after.ok).toBe(true)
        if (!before.ok || !after.ok) return
        expect(after.runs.length).toBe(before.runs.length + 1)
        // The thing real GitHub cannot be asked for: a run that has not finished.
        expect(after.runs[0]!.status).toBe('queued')
        expect(after.runs[0]!.conclusion).toBeNull()
        expect(after.runs[0]!.event).toBe('workflow_dispatch')
    })

    it('keeps one workflow out of another workflow\'s history', async () => {
        const other = DISPATCHABLE_WORKFLOWS.find((workflow) => workflow.slug !== handicaps.slug)!
        const outcome = await client.recentRuns(other, 10)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.runs.every((run) => run.event !== 'workflow_dispatch')).toBe(true)
    })

    it('honours per_page, because the page asks for ten and shows what it gets', async () => {
        const outcome = await client.recentRuns(handicaps, 1)
        expect(outcome.ok && outcome.runs.length).toBe(1)
    })

    it('narrows the history to the window the mirror asks for', async () => {
        // The question every sync asks: "anything since last time?" Against the
        // real API this is the difference between 36 bytes and 1.5 MB, so a
        // stand-in that ignored it would let the cheap path look exercised while
        // nothing local ever took it.
        const all = await client.recentRuns(handicaps, 100)
        expect(all.ok).toBe(true)
        if (!all.ok) return
        const newest = all.runs[0]!

        const since = await client.recentRuns(handicaps, 100, 1, new Date(newest.startedAt))
        expect(since.ok && since.runs.map((run) => run.runNumber)).toEqual([newest.runNumber])

        const after = await client.recentRuns(handicaps, 100, 1, new Date(Date.now() + 60_000))
        expect(after.ok && after.runs).toEqual([])
    })

    it('includes a run sitting exactly on the boundary, because the client asks with >=', async () => {
        /*
         * The mirror sets this window to a run's own timestamp when it is
         * chasing an outcome it does not know yet, so an exclusive boundary
         * would answer with the one run it was asking about missing. Real
         * GitHub was checked on this: `>` returns nothing where `>=` returns
         * the run.
         */
        const all = await client.recentRuns(handicaps, 100)
        if (!all.ok) return expect.fail('expected a history')
        const oldest = all.runs[all.runs.length - 1]!

        const outcome = await client.recentRuns(handicaps, 100, 1, new Date(oldest.startedAt))
        expect(outcome.ok && outcome.runs.map((run) => run.runNumber)).toContain(oldest.runNumber)
    })

    it('answers a filter it cannot parse with no runs, which is what GitHub does', async () => {
        /*
         * The failure `lib/workflow-runs.ts` is built around, and the reason
         * this stand-in models the filter at all. An unparseable `created` is
         * not a 422 — it is zero runs and a 200, indistinguishable from a
         * repository where nothing has happened. Asked here through a raw fetch
         * rather than the client, because the client renders its window from a
         * `Date` and so cannot produce a malformed one.
         */
        const response = await fetch(
            `${base}/repos/${repository}/actions/workflows/${handicaps.file}/runs?created=${encodeURIComponent('>tuesday')}`,
            { headers: { authorization: 'Bearer stand-in' } }
        )
        expect(response.status).toBe(200)
        expect((await response.json()).workflow_runs).toEqual([])
    })

    it('serves a file out of the working tree in the encoding the client decodes', async () => {
        const outcome = await client.readFile('admin/package.json')
        expect(outcome.ok).toBe(true)
        if (!outcome.ok || !outcome.file.present) return expect.fail('expected the file to be present')
        expect(JSON.parse(outcome.file.text).name).toBe('hector-admin')
        expect(outcome.file.sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('reports a missing file as absent rather than as a failure, which is the first run', async () => {
        const outcome = await client.readFile('astrosite/src/data/nothing-here.json')
        expect(outcome).toEqual({ ok: true, file: { present: false } })
    })

    it('answers a directory with the files in it, which is what the bucket recompute reads', async () => {
        const outcome = await client.listDirectory('astrosite/src/data/events/hector')
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return expect.fail('expected the directory to be listed')
        expect(outcome.files.length).toBeGreaterThan(0)
        expect(outcome.files.every((path) => path.startsWith('astrosite/src/data/events/hector/'))).toBe(true)
        expect(outcome.files).toEqual([...outcome.files].sort())
    })

    it('fails on a directory that is not there, rather than calling it empty', async () => {
        expect(await client.listDirectory('astrosite/src/data/nowhere')).toEqual({ ok: false, reason: 'not-found' })
    })

    it('takes a commit and serves it back, without touching the checkout', async () => {
        const path = 'astrosite/src/data/handicaps/history.json'
        const committed = await client.commitFile({
            path,
            text: '["first"]',
            message: 'a shadow run that stopped shadowing',
            sha: undefined,
            committer: { name: 'hector-admin', email: 'noreply@hector.golf' },
        })
        expect(committed.ok).toBe(true)

        const read = await client.readFile(path)
        expect(read.ok && read.file.present && read.file.text).toBe('["first"]')
        // In memory, not on disk: a stand-in that edited the repository would
        // turn a dry run into a real one.
        expect(state.written.has(path)).toBe(true)
    })

    it('refuses a stale sha with the conflict the commit retry is written for', async () => {
        const path = 'astrosite/src/data/handicaps/history.json'
        const outcome = await client.commitFile({
            path,
            text: '["second"]',
            message: 'written against a sha that has moved',
            sha: '0'.repeat(40),
            committer: { name: 'hector-admin', email: 'noreply@hector.golf' },
        })
        expect(outcome).toEqual({ ok: false, reason: 'conflict' })
    })

    /**
     * The reason the knob exists: these six are what `FAILURE_MESSAGES` renders,
     * and none of them can be summoned from real GitHub because you would like to
     * read the message. `not-configured` is missing on purpose — it is decided
     * before a request is made, so no answer can produce it.
     */
    it.each(['unauthorized', 'not-found', 'rate-limited', 'unavailable', 'unknown'] as const)(
        'produces %s on demand, classified the way the page reads it',
        async (reason) => {
            const { port } = server.address() as AddressInfo
            await fetch(`http://127.0.0.1:${port}/_fake/fail?reason=${reason}`, { method: 'POST' })
            expect(await client.dispatch(handicaps)).toEqual({ ok: false, reason })
            await fetch(`http://127.0.0.1:${port}/_fake/fail?reason=none`, { method: 'POST' })
        }
    )

    it('is answering normally again once the knob is cleared', async () => {
        expect(await client.dispatch(handicaps)).toEqual({ ok: true })
    })

    /**
     * The other thing real GitHub will not produce to order.
     *
     * The expiry warning on `/operations` is driven by a header whose value is a
     * date eleven months away, so without this the notice ships having never been
     * looked at — and the first person to see it would be somebody discovering
     * that the token lapsed.
     *
     * A client of its own rather than the shared one above, because the real
     * client remembers the last expiry it saw and never unlearns it. Reusing the
     * shared client would leave a date behind for whatever runs next.
     */
    describe('a token with a date on it', () => {
        const freshClient = (port: number) =>
            createGitHubClient({ repository, token: async () => 'fake-token', baseUrl: `http://127.0.0.1:${port}` })

        const setExpiry = async (port: number, asked: string) =>
            fetch(`http://127.0.0.1:${port}/_fake/expiry?in=${encodeURIComponent(asked)}`, { method: 'POST' })

        it('says nothing about an expiry until it is asked to, the way a classic token never does', async () => {
            const { port } = server.address() as AddressInfo
            const mine = freshClient(port)

            expect(await mine.dispatch(handicaps)).toEqual({ ok: true })
            expect(mine.tokenExpiry()).toBeUndefined()
        })

        it('carries a date the real client reads, in the format real GitHub writes', async () => {
            const { port } = server.address() as AddressInfo
            await setExpiry(port, '5d')
            const mine = freshClient(port)

            expect(await mine.dispatch(handicaps)).toEqual({ ok: true })
            // 5d out and read immediately, so the floor lands on 4 rather than 5.
            expect(mine.tokenExpiry()?.daysLeft).toBe(4)

            await setExpiry(port, 'none')
        })

        /*
         * The state the warning is ultimately about. A duration in the past is
         * allowed by the knob on purpose: a token that lapsed while nobody was
         * looking is the failure this whole path exists to make visible, and it
         * has to be renderable.
         */
        it('can be given a date that has already gone', async () => {
            const { port } = server.address() as AddressInfo
            await setExpiry(port, '-2d')
            const mine = freshClient(port)

            expect(await mine.dispatch(handicaps)).toEqual({ ok: true })
            expect(mine.tokenExpiry()?.daysLeft).toBeLessThan(0)

            await setExpiry(port, 'none')
        })

        it('refuses a duration it cannot read, rather than silently forgetting the date', async () => {
            const { port } = server.address() as AddressInfo
            const response = await setExpiry(port, 'whenever')
            expect(response.status).toBe(400)
        })
    })
})

/**
 * The link out of the run log.
 *
 * GitHub's run page is what an admin clicks through to from the Operations
 * table, so a stand-in that answers the API but not the link leaves a dead end
 * in the middle of the flow it exists to support. It used to be worse than a
 * dead end: `http://localhost/...` with the port missing, which resolves to
 * somebody else's server or to nothing at all.
 */
describe('the page behind a run', () => {
    const repository = 'hectorgolf/hector.golf'
    const handicaps = workflowBySlug('handicaps')!

    let server: Server
    let client: GitHubClient
    let origin: string

    beforeAll(async () => {
        const state = emptyState()
        seedHistory(state, [handicaps.file])
        server = createServer(state, repository)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        client = createGitHubClient({ repository, token: async () => 'fake-token', baseUrl: origin })
    })

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    it('is linked from the run the API reports, at an address that resolves', async () => {
        const outcome = await client.recentRuns(handicaps, 1)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return

        // The host the caller used, so the browser on the same machine can
        // follow it. Not `localhost` with no port, which is a link to nothing.
        expect(outcome.runs[0]!.url.startsWith(origin)).toBe(true)
        expect(new URL(outcome.runs[0]!.url).port).not.toBe('')
    })

    it('answers that link with a page, without a bearer token', async () => {
        const outcome = await client.recentRuns(handicaps, 1)
        if (!outcome.ok) return expect.fail('expected a run')

        // No Authorization header: a browser following a link sends none, and
        // the page has to be reachable anyway.
        const response = await fetch(outcome.runs[0]!.url)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')

        const html = await response.text()
        expect(html).toContain(`#${outcome.runs[0]!.runNumber}`)
        expect(html).toContain(handicaps.file)
        // The one thing the page must never let anybody forget.
        expect(html).toContain('This is not GitHub')
    })

    it('shows a dispatched run progressing, and says it is still going', async () => {
        expect(await client.dispatch(handicaps)).toEqual({ ok: true })
        const outcome = await client.recentRuns(handicaps, 1)
        if (!outcome.ok) return expect.fail('expected a run')

        const html = await fetch(outcome.runs[0]!.url).then((response) => response.text())
        expect(html).toContain('queued')
        expect(html).toContain('workflow_dispatch')
        // Refreshes itself while unfinished: watching a run progress is the one
        // thing a real dispatch is too slow to let you do.
        expect(html).toContain('http-equiv="refresh"')
    })

    it('says so for a run it has never heard of, rather than inventing one', async () => {
        const response = await fetch(`${origin}/${repository}/actions/runs/99999`)
        expect(response.status).toBe(404)
        expect(await response.text()).toContain('no run #99999')
    })

    it('does not answer the run page for another repository, and says which it is', async () => {
        const response = await fetch(`${origin}/someone/else/actions/runs/1`)
        expect(response.status).toBe(404)

        const html = await response.text()
        expect(html).toContain('someone/else')
        expect(html).toContain(repository)
    })

    it('blames the number, not the repository, when only the number is wrong', async () => {
        const html = await fetch(`${origin}/${repository}/actions/runs/99998`).then((r) => r.text())
        // Naming the same repository twice answers nobody's question.
        expect(html).not.toContain('It answers for')
        expect(html).toContain('remembers only the runs dispatched since it started')
    })
})
