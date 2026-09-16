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

    beforeAll(async () => {
        state = emptyState()
        seedHistory(
            state,
            DISPATCHABLE_WORKFLOWS.map((workflow) => workflow.file)
        )
        server = createServer(state, repository)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const { port } = server.address() as AddressInfo
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
})
