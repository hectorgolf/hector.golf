/**
 * A stand-in for GitHub's REST API, for a laptop.
 *
 * The sibling of `dev-iap.ts`, and built on the same principle: stand in front
 * of the application rather than putting a switch inside it. `dev-iap.ts` plays
 * IAP so the admin can be signed in to locally; this plays the four calls
 * `src/lib/github.ts` makes, so the Operations page can be *used* locally
 * instead of merely rendered.
 *
 *   npm run dev:fake                              # this, the Firestore emulator and the admin
 *   npx tsx scripts/fake-github.ts                # just this, on port 8433
 *
 * ## Why a fake rather than a scratch repository
 *
 * Pointing `GITHUB_REPOSITORY` at a throwaway repository with a real token needs
 * no code at all, and for one question — does our request shape satisfy GitHub —
 * it is strictly better than this. That question is already answered by the
 * deployment, though, and the questions it cannot answer are the ones worth
 * having a stand-in for:
 *
 * - **A run that is in progress.** `TONE_PILL.running` on the Operations page
 *   has never been seen locally, because a real dispatch takes a minute or two
 *   to start and there is nothing to look at while it does. Here a dispatch
 *   creates a run that is queued, then running, then finished, on a clock short
 *   enough to watch.
 * - **Every failure.** `FAILURE_MESSAGES` has six entries and `GitHubTokenHelp`
 *   two modes, and a rate limit or an expired token is not something real GitHub
 *   will produce because you would like to see the message. `POST /_fake/fail`
 *   produces any of them on demand.
 * - **The commit conflict.** `commitFile` retries a 409 three times and the
 *   append-only guard in `lib/jobs/backup.ts` sits behind it. Losing that race
 *   against real GitHub means arranging for somebody else to commit at the right
 *   moment; here it is a query parameter.
 *
 * ## What it is faithful about, and what it is not
 *
 * The response shapes are GitHub's, because the real client parses them: base64
 * with an `encoding` field and a blob sha, `workflow_runs` with `run_started_at`
 * and `html_url`, 204 with no body for a dispatch, 409 for a stale sha. Anything
 * this got wrong would be caught by `test/fake-github.test.ts`, which drives it
 * through the real `createGitHubClient` rather than through assertions written
 * against the same assumptions twice.
 *
 * What it is not is an authorisation model. It checks that a bearer token was
 * sent and does not care what it is, because the token is not the thing being
 * exercised — `not-configured` is decided in `github.ts` before a request is
 * made, and `unauthorized` is available from the failure knob.
 *
 * It also serves file contents **read-only from the working tree** and keeps
 * commits in memory. A stand-in that wrote to the checkout would turn a shadow
 * run into an edit of the repository, which is the one thing `dryRun` exists to
 * prevent.
 *
 * ## Where it may run
 *
 * Development only, enforced rather than trusted: it refuses NODE_ENV=production
 * and binds loopback. `github.ts` will not talk to it anywhere else either — the
 * override it answers is restricted to loopback addresses, because every call
 * carries the dispatch token. It lives in `scripts/`, which the container image
 * does not copy.
 */
import { readFileSync, existsSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GitHubFailure } from '../src/lib/github.ts'

export const DEFAULT_PORT = 8433

/** The repository root, which is where `contents` reads from. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * How long a dispatched run spends in each state.
 *
 * Short enough to watch and long enough to see. The Operations page is not
 * polled — it renders what was true when it loaded — so these are tuned to the
 * rhythm of pressing a button and then reloading the page once or twice, which
 * is the only way to observe a run progressing there.
 */
export const QUEUED_MS = 3_000
export const RUNNING_MS = 12_000

type Run = {
    workflowFile: string
    runNumber: number
    startedAt: string
    event: string
    /** Set for the seeded history, so those runs do not move. */
    frozen?: { status: string; conclusion: string | null }
}

/**
 * Everything the stand-in remembers, in one place so that a reset is a single
 * assignment and a test can have its own.
 */
export type FakeState = {
    runs: Run[]
    /** Commits, by path. Shadows the working tree without touching it. */
    written: Map<string, { text: string; sha: string }>
    /** What every call should fail with, until told otherwise. */
    failing?: GitHubFailure
    nextRunNumber: number
}

export const emptyState = (): FakeState => ({ runs: [], written: new Map(), nextRunNumber: 1 })

/** A blob sha, derived so that the same text always gets the same one. */
export const shaOf = (text: string): string => createHash('sha1').update(text).digest('hex')

/**
 * A little history, so the page has something to show before anything is pressed.
 *
 * Two completed runs per workflow at plausible small hours, because an empty log
 * hides the two things that log is for: the repeating time of day, and the
 * cadence logic in `lib/cadence.ts` deciding what is stale. A page that is blank
 * until you press something cannot exercise either.
 */
export function seedHistory(state: FakeState, workflowFiles: readonly string[], now = new Date()): void {
    for (const workflowFile of workflowFiles) {
        for (const hoursAgo of [27, 3]) {
            state.runs.push({
                workflowFile,
                runNumber: state.nextRunNumber++,
                startedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
                event: 'schedule',
                frozen: { status: 'completed', conclusion: 'success' },
            })
        }
    }
}

/**
 * What a run looks like now.
 *
 * Derived from its age rather than advanced by a timer, so there is nothing to
 * tick and no way for the state to disagree with the clock. A seeded run carries
 * its answer with it.
 */
export function runStatus(run: Run, now = Date.now()): { status: string; conclusion: string | null } {
    if (run.frozen) return run.frozen
    const age = now - new Date(run.startedAt).getTime()
    if (age < QUEUED_MS) return { status: 'queued', conclusion: null }
    if (age < QUEUED_MS + RUNNING_MS) return { status: 'in_progress', conclusion: null }
    return { status: 'completed', conclusion: 'success' }
}

/** GitHub's JSON for one run, in the shape `recentRuns` reads. */
const runBody = (run: Run, repository: string, now = Date.now()) => ({
    ...runStatus(run, now),
    run_started_at: run.startedAt,
    created_at: run.startedAt,
    event: run.event,
    run_number: run.runNumber,
    html_url: `http://localhost/${repository}/actions/runs/${run.runNumber}`,
})

/**
 * The status and headers each failure is produced by.
 *
 * Read off `classify()` in `github.ts` rather than invented: the point of the
 * knob is to exercise that function's branches, so these have to be inputs it
 * actually maps the way the name says. `not-configured` is absent deliberately —
 * it is decided before a request is made and cannot be produced by answering one.
 */
export const FAILURE_RESPONSES: Record<Exclude<GitHubFailure, 'not-configured'>, [number, Record<string, string>]> = {
    unauthorized: [403, {}],
    'not-found': [404, {}],
    'rate-limited': [403, { 'x-ratelimit-remaining': '0' }],
    unavailable: [503, {}],
    unknown: [418, {}],
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
}

/**
 * A path under the repository root, or nothing.
 *
 * The stand-in is loopback-only and single-user, so this is not holding back an
 * attacker — it is holding back `..` in a path the *application* built, which is
 * the realistic way a bug here would end up reading a developer's home directory
 * and putting it in an HTTP response.
 */
export function resolveInRepo(path: string): string | undefined {
    const resolved = normalize(join(repoRoot, path))
    return resolved.startsWith(normalize(repoRoot)) ? resolved : undefined
}

export function handle(state: FakeState, repository: string, req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = decodeURIComponent(url.pathname)

    // The control surface, under a prefix GitHub does not use.
    if (path === '/_fake/fail' && req.method === 'POST') {
        const reason = url.searchParams.get('reason')
        state.failing = reason && reason !== 'none' ? (reason as GitHubFailure) : undefined
        return json(res, 200, { failing: state.failing ?? null })
    }
    if (path === '/_fake/state') {
        return json(res, 200, {
            failing: state.failing ?? null,
            runs: state.runs.length,
            written: [...state.written.keys()],
        })
    }

    // Not the absence of an authorisation model so much as the presence of the
    // one assertion worth making: the real client must always send a token.
    if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
        return json(res, 401, { message: 'no bearer token; the real client always sends one' })
    }

    if (state.failing && state.failing !== 'not-configured') {
        const [status, headers] = FAILURE_RESPONSES[state.failing]
        return json(res, status, { message: `fake-github is failing with ${state.failing}` }, headers)
    }

    const prefix = `/repos/${repository}`
    if (!path.startsWith(`${prefix}/`)) {
        return json(res, 404, { message: `fake-github only answers for ${repository}` })
    }
    const rest = path.slice(prefix.length)

    const dispatch = rest.match(/^\/actions\/workflows\/([^/]+)\/dispatches$/)
    if (dispatch && req.method === 'POST') {
        state.runs.push({
            workflowFile: dispatch[1]!,
            runNumber: state.nextRunNumber++,
            startedAt: new Date().toISOString(),
            event: 'workflow_dispatch',
        })
        // 204 with no body, which is what GitHub answers and what makes the run
        // id unavailable to the dispatcher.
        res.writeHead(204)
        res.end()
        return
    }

    const runs = rest.match(/^\/actions\/workflows\/([^/]+)\/runs$/)
    if (runs && req.method === 'GET') {
        const limit = Number(url.searchParams.get('per_page') ?? 30)
        const matching = state.runs
            .filter((run) => run.workflowFile === runs[1])
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit)
        return json(res, 200, { workflow_runs: matching.map((run) => runBody(run, repository)) })
    }

    const contents = rest.match(/^\/contents\/(.+)$/)
    if (contents && req.method === 'GET') {
        const file = contents[1]!
        const written = state.written.get(file)
        if (written) {
            return json(res, 200, {
                content: Buffer.from(written.text, 'utf-8').toString('base64'),
                encoding: 'base64',
                sha: written.sha,
            })
        }
        const onDisk = resolveInRepo(file)
        if (!onDisk || !existsSync(onDisk)) {
            // The first-run state, which `readFile` turns into `present: false`
            // rather than a failure.
            return json(res, 404, { message: 'Not Found' })
        }
        const text = readFileSync(onDisk, 'utf-8')
        return json(res, 200, {
            content: Buffer.from(text, 'utf-8').toString('base64'),
            encoding: 'base64',
            sha: shaOf(text),
        })
    }

    if (contents && req.method === 'PUT') {
        const file = contents[1]!
        let body: { content?: string; sha?: string; message?: string }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
            } catch {
                return json(res, 400, { message: 'unreadable body' })
            }

            // The conflict, on purpose: a sha that does not match what is there
            // now is exactly the race `commitFile` retries, and `?conflict=1`
            // forces it without having to arrange the race.
            const current =
                state.written.get(file)?.sha ??
                (() => {
                    const onDisk = resolveInRepo(file)
                    return onDisk && existsSync(onDisk) ? shaOf(readFileSync(onDisk, 'utf-8')) : undefined
                })()
            const stale = url.searchParams.get('conflict') === '1' || (current !== undefined && body.sha !== current)
            if (stale) {
                return json(res, 409, { message: 'the file moved under you' })
            }

            const text = Buffer.from(body.content ?? '', 'base64').toString('utf-8')
            const sha = shaOf(text)
            state.written.set(file, { text, sha })
            return json(res, 200, { commit: { sha: shaOf(`${file}:${sha}:${body.message ?? ''}`) } })
        })
        return
    }

    json(res, 404, { message: `fake-github does not answer ${req.method} ${path}` })
}

export function createServer(state: FakeState, repository: string): http.Server {
    return http.createServer((req, res) => handle(state, repository, req, res))
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        console.error('fake-github is a development tool and refuses to run with NODE_ENV=production.')
        process.exit(1)
    }

    // Read here rather than imported from `lib/github.ts`, which would pull the
    // Secret Manager client in behind it.
    const repository = process.env.GITHUB_REPOSITORY ?? 'hectorgolf/hector.golf'
    const port = Number(process.env.FAKE_GITHUB_PORT ?? DEFAULT_PORT)
    const { DISPATCHABLE_WORKFLOWS } = await import('../src/lib/workflows.ts')

    const state = emptyState()
    seedHistory(
        state,
        DISPATCHABLE_WORKFLOWS.map((workflow) => workflow.file)
    )

    createServer(state, repository).listen(port, '127.0.0.1', () => {
        console.log(`\nfake-github on http://127.0.0.1:${port}, answering for ${repository}`)
        console.log(`  Point the admin at it:  GITHUB_API_BASE_URL=http://127.0.0.1:${port}`)
        console.log(`  Make everything fail:   curl -XPOST 'http://127.0.0.1:${port}/_fake/fail?reason=rate-limited'`)
        console.log(`  Stop failing:           curl -XPOST 'http://127.0.0.1:${port}/_fake/fail?reason=none'`)
        console.log(`  What it is holding:     curl http://127.0.0.1:${port}/_fake/state\n`)
    })
}

// Only when run directly, so importing this for a test starts no server.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    await main()
}
