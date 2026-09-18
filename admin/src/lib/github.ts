import { createHash } from 'node:crypto'

import { githubToken } from './secrets.ts'
import { DISPATCH_REF, type DispatchableWorkflow } from './workflows.ts'

/**
 * The slice of GitHub's REST API this service uses: start a workflow, say when
 * it last ran, and read and write one file.
 *
 * Written against `fetch` rather than Octokit. Four calls still do not justify a
 * dependency whose job is the other two hundred, and this way the container has
 * one fewer thing to install and audit. The precedent for the other choice
 * exists — `astrosite/src/code/leaderboards/github.ts` writes its files with
 * Octokit — so this is a preference rather than a rule, and the count is the
 * thing to watch: the day a job needs the trees API to commit several files
 * atomically is the day this stops being the cheaper side.
 */

/**
 * Which repository to act on. `terraform/cloud_run.tf` sets it from
 * `var.github_repository`, the same variable that decides which repository may
 * mint tokens through Workload Identity Federation, so the deployment cannot be
 * pointed at one repository for CI and another for this.
 */
export const repository = process.env.GITHUB_REPOSITORY ?? 'hectorgolf/hector.golf'

/**
 * Why a call did not work, in terms that suggest what to do about it. The raw
 * response is not one of those terms — it can carry token prefixes and rate
 * limit detail — and this service is built to survive being deployed without IAP
 * in front of it, so response bodies are assumed public.
 */
export type GitHubFailure =
    /** No token in this deployment. Expected before the setup step that creates one. */
    | 'not-configured'
    /** The token is wrong, expired, or lacks the Actions permission. */
    | 'unauthorized'
    /**
     * GitHub says there is no such workflow. Note that a fine-grained token
     * without access to the repository answers 404 rather than 403 — it hides
     * the repository's existence — so this and `unauthorized` are not as far
     * apart as they read.
     */
    | 'not-found'
    | 'rate-limited'
    | 'unavailable'
    | 'unknown'

export type DispatchOutcome = { ok: true } | { ok: false; reason: GitHubFailure }

/** What the Admin UI shows about a workflow's recent history. */
export type WorkflowRun = {
    /** `queued`, `in_progress` or `completed`. */
    status: string
    /** `success`, `failure`, … — null while the run is still going. */
    conclusion: string | null
    /** ISO 8601, as GitHub returns it. */
    startedAt: string
    /** What set it off: `schedule`, `workflow_dispatch`, … */
    event: string
    runNumber: number
    url: string
}

export type RunsOutcome = { ok: true; runs: WorkflowRun[] } | { ok: false; reason: GitHubFailure }

/**
 * A file as GitHub holds it: its text, and the blob sha that has to be quoted
 * back when replacing it.
 *
 * `absent` rather than a `not-found` failure, because a backup file that does
 * not exist yet is the normal state on the first run rather than something to
 * report. The caller creates it by writing with no `sha`.
 */
export type FileContent = { present: true; text: string; sha: string } | { present: false }

export type ReadFileOutcome = { ok: true; file: FileContent } | { ok: false; reason: GitHubFailure }

/**
 * `conflict` is separated out from the other failures because it is the only one
 * with a sensible automatic response: somebody else wrote the file between the
 * read and the write, so re-read and try again. The four data-update workflows
 * all end in `git pull -r && git push` and share a concurrency group for exactly
 * this reason; a commit made from here is outside that group and has to handle
 * the race itself.
 */
export type CommitOutcome = { ok: true; commit: string } | { ok: false; reason: GitHubFailure | 'conflict' }

export type CommitRequest = {
    path: string
    text: string
    message: string
    /** The blob sha being replaced, or undefined to create the file. */
    sha: string | undefined
    committer: { name: string; email: string }
}

/**
 * When the token stops working, and how long that leaves.
 *
 * `daysLeft` is whole days, truncated *towards zero* rather than rounded down,
 * which is the one arithmetic choice here worth stating. Towards zero is the
 * conservative direction on both sides of the date at once: with six days and
 * twenty-three hours left it says six, so a threshold is crossed early rather
 * than late; three days and a minute after the date it says three days ago
 * rather than four, so a heading does not age the lapse faster than the clock.
 * Rounding down does the first and gets the second wrong.
 *
 * Negative once the date has passed, which is reachable rather than
 * theoretical — an expired token is answered with a 401 that carries no expiry
 * header at all, so the last value seen stays behind and ages into the past. It
 * is also the state that matters least: `unauthorized` arrives alongside it, and
 * a page has something stronger to say than "expiring soon" by then.
 */
export type TokenExpiry = {
    at: Date
    daysLeft: number
}

/**
 * When to start saying something, and when to start insisting.
 *
 * Both are generous, and the reason is that nobody watches this page. It is
 * opened when something is already wrong, so a window has to be wide enough to
 * contain a visit that happens for an unrelated reason — a week's warning on a
 * page read once a month is a warning nobody sees. Sixty days spans a holiday
 * and a quiet spell; thirty is still a month of the notice being red before
 * anything breaks.
 *
 * The cost of being early is a line on a page nobody has to act on yet. The
 * cost of being late is the scheduled updates stopping, so the asymmetry is the
 * whole argument. Neither number is tuned — there is nothing to tune against
 * until a token has actually lapsed.
 */
export const EXPIRY_WARN_DAYS = 60
export const EXPIRY_URGENT_DAYS = 30

/** The header GitHub answers a fine-grained token's every call with. */
const EXPIRY_HEADER = 'github-authentication-token-expiration'

/**
 * That header as a date, or nothing when it is absent or unreadable.
 *
 * The format is `2027-09-14 20:32:16 UTC`: a space where ISO 8601 wants a `T`,
 * and a zone name where it wants a `Z`. Node happens to parse it as it stands,
 * but `Date.parse` on anything outside ISO 8601 is explicitly
 * implementation-defined, so it is taken apart here rather than trusted. The
 * failure being avoided is a quiet one — an `Invalid Date` under a future
 * runtime would leave the page looking exactly like a healthy token.
 *
 * Nothing is the normal answer for two callers that are not broken: a classic
 * PAT, which has no expiry to report, and `scripts/fake-github.ts` unless it has
 * been asked for one. Both have to read as "no idea" rather than as "fine",
 * which is why this returns `undefined` and not a far-future date.
 */
export function parseTokenExpiry(header: string | null | undefined): Date | undefined {
    if (!header) return undefined

    const match = header.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(UTC|Z|[+-]\d{2}:?\d{2}))?$/i)
    // An unrecognised shape is silence rather than a guess: GitHub changing this
    // format should cost the warning, never invent one against a wrong date.
    if (!match) return undefined

    const [, date, time, zone] = match
    const offset = !zone || /^(?:UTC|Z)$/i.test(zone) ? 'Z' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
    const parsed = new Date(`${date}T${time}${offset}`)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * Which token a remembered expiry belongs to.
 *
 * Hashed rather than kept, so that nothing here holds a second long-lived
 * reference to the credential and an accidental log line is harmless. The
 * comparison only ever needs to answer "is this the same token as last time",
 * which a digest does as well as the string.
 */
const fingerprint = (token: string): string => createHash('sha256').update(token).digest('hex')

export type GitHubClient = {
    dispatch(workflow: DispatchableWorkflow): Promise<DispatchOutcome>
    /**
     * One page of a workflow's run history, newest first.
     *
     * `page` is GitHub's own paging, and it is here for `lib/workflow-runs.ts`:
     * the mirror pages back through the history the first time it meets a
     * workflow. Everything else asks for page 1 by asking for nothing.
     *
     * `createdSince` narrows the answer to runs created at or after a moment,
     * which is the difference between a 36-byte reply and a 1.5 MB one on the
     * question the mirror asks most — "has anything run since I last looked".
     *
     * Inclusive, `created:>=`, and the boundary is not academic: a window set to
     * a run's own timestamp is exactly how the mirror asks after a run whose
     * outcome it does not know yet, and `>` answers that with the one run it was
     * asking about missing. Checked against the API — `>2026-09-18T17:52:52Z`
     * returns nothing where `>=` returns run #1542.
     *
     * It must be an instant the caller built from a `Date`, never a string from
     * storage: GitHub answers an unparseable filter with *zero runs and a 200*,
     * so a malformed one reads exactly like a quiet repository.
     * `lib/workflow-runs.ts` normalises through `toISOString()` for that reason,
     * and falls back to an unfiltered walk when it cannot.
     */
    recentRuns(
        workflow: DispatchableWorkflow,
        limit?: number,
        page?: number,
        createdSince?: Date
    ): Promise<RunsOutcome>
    readFile(path: string, ref?: string): Promise<ReadFileOutcome>
    commitFile(request: CommitRequest): Promise<CommitOutcome>
    /**
     * What the token currently in use last said about its own expiry, or nothing
     * if it has not said — either because no call has been made yet, or because
     * it is a classic token with no expiry to report.
     *
     * A side channel rather than a probe, and deliberately: the header rides on
     * requests this service was making anyway, so knowing costs no call, no rate
     * limit and no extra failure mode. The price is that it is empty until
     * something has talked to GitHub — a caller that has not awaited one of the
     * calls above will be told "no idea" and should render nothing.
     *
     * "Currently in use" is load-bearing. The answer is tied to the token it came
     * from, so rotating replaces it — including replacing it with nothing, which
     * is how a move onto a token without an expiry clears a warning the previous
     * one raised. See the two branches in `call()`.
     */
    tokenExpiry(now?: Date): TokenExpiry | undefined
}

/** GitHub, in production and by default everywhere else. */
export const GITHUB_API = 'https://api.github.com'

/**
 * Where the stand-in may live, and nowhere else.
 *
 * This is the whole of the security argument for the override below, so it is
 * worth stating rather than implying: `headers()` puts the dispatch token in an
 * `Authorization` header on **every** call, so whatever host this resolves to is
 * handed a credential that can push to the repository. A base URL is therefore
 * not the harmless piece of configuration it looks like — it is a "send my token
 * here" instruction — and the one property that makes it safe to have at all is
 * that the answer can never be a machine other than this one.
 *
 * Loopback only, then. A typo, a stale `.env`, a variable inherited from
 * somewhere unexpected: the worst any of them can do is break a developer's
 * admin, which is recoverable, rather than post the token to a host somebody
 * else controls, which is not.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Where GitHub is.
 *
 * Unset in every deployment — `terraform/cloud_run.tf` does not set it and must
 * not — so production reads exactly one line of this and it is the constant
 * above. What the variable is for is `scripts/fake-github.ts`, which speaks the
 * four calls this client makes so that the Operations page can be exercised on a
 * laptop: a dispatched run that actually appears and progresses, a rate limit
 * that can be summoned on demand, a commit conflict that can be reproduced.
 *
 * ## Why this throws rather than falling back
 *
 * Falling back to real GitHub is the tempting behaviour and the dangerous one.
 * The person who set this variable did so to *stop* talking to GitHub; quietly
 * doing it anyway means their next button press dispatches a real workflow
 * against the real repository with a real token, believing it went to a stub.
 * A configuration error should not be resolvable into the one outcome nobody
 * asked for, so there are two answers here and they are "the stand-in" and "a
 * loud stop" — never "actually, GitHub".
 *
 * The throw is safe to have because it cannot reach a deployment: the variable
 * is unset there, and `github()` is lazy, so an unset variable never runs this
 * past its first line. This is the reverse of the rule in `secrets.ts` about
 * dependencies that can stop the service from starting, and deliberately so —
 * that rule is about somebody else's outage, and this is about a value only a
 * developer on a laptop can have typed.
 */
export function apiBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
    const override = environment.GITHUB_API_BASE_URL?.trim()
    if (!override) return GITHUB_API

    let parsed: URL
    try {
        parsed = new URL(override)
    } catch {
        throw new Error(`GITHUB_API_BASE_URL is not a URL: ${override}`)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`GITHUB_API_BASE_URL must be http or https, not ${parsed.protocol}`)
    }
    // Credentials in the URL would be sent on every call and logged with it.
    if (parsed.username || parsed.password) {
        throw new Error('GITHUB_API_BASE_URL must not carry a username or password')
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
        throw new Error(
            `GITHUB_API_BASE_URL may only point at this machine, not ${parsed.hostname}. ` +
                'Every call carries the dispatch token, so the override is restricted to loopback ' +
                'addresses — see scripts/fake-github.ts.'
        )
    }

    // Trailing slashes would double up against the paths built below.
    return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}

/**
 * Headers GitHub asks every caller for. The API version is pinned rather than
 * left to default, so a change on their side is something we adopt rather than
 * something that happens to us. `User-Agent` is not optional: GitHub rejects
 * requests without one.
 */
const headers = (token: string): Record<string, string> => ({
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'hector-admin',
    // Set on every call rather than only the one with a body. Harmless on a GET,
    // and one fewer thing to remember when a third call is added.
    'content-type': 'application/json',
})

/**
 * A status code, plus the one header that tells 403-for-rate-limit apart from
 * 403-for-permission, turned into a reason.
 */
function classify(response: { status: number; headers: Headers }): GitHubFailure {
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return exhausted ? 'rate-limited' : 'unauthorized'
    if (response.status === 401) return 'unauthorized'
    if (response.status === 404) return 'not-found'
    if (response.status >= 500) return 'unavailable'
    return 'unknown'
}

export type GitHubClientOptions = {
    repository: string
    /** Asked per call rather than held, so a rotated token is picked up. */
    token: () => Promise<string | undefined>
    /** Injectable so the tests do not have to stub a global. */
    fetch?: typeof globalThis.fetch
    /**
     * Where GitHub is, for the local stand-in. Defaults to `apiBaseUrl()`, which
     * is `GITHUB_API` unless a loopback override is configured.
     */
    baseUrl?: string
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
    const doFetch = options.fetch ?? globalThis.fetch
    const api = options.baseUrl ?? apiBaseUrl()
    const base = `${api}/repos/${options.repository}/actions/workflows`
    const contents = `${api}/repos/${options.repository}/contents`

    /**
     * The last expiry GitHub mentioned, and which token it was talking about.
     *
     * Kept together because an expiry belongs to a token value rather than to
     * this service: a date learned from one token says nothing about the next.
     * One slot rather than a map keyed by token, because only one token is ever
     * current — a map would accumulate an entry per rotation and never be asked
     * about any of them again.
     *
     * `at` is allowed to be undefined against a known fingerprint. That is the
     * meaningful state for a classic token, which carries no expiry at all: we
     * have heard from it, and the answer was nothing.
     */
    let known: { fingerprint: string; at: Date | undefined } | undefined

    /**
     * Everything every call does the same way: get a token, call, classify.
     *
     * `expected` names statuses the caller wants to interpret itself rather than
     * have turned into a failure — a 404 from the contents API means "no file
     * yet", which is the first run rather than a problem, and a 409 means
     * somebody committed between our read and our write, which is a retry rather
     * than an error. Anything not named here is still classified and logged.
     */
    async function call(url: string, init: RequestInit, expected: number[] = []): Promise<Response | GitHubFailure> {
        const token = await options.token()
        if (!token) return 'not-configured'

        try {
            const response = await doFetch(url, { ...init, headers: headers(token) })

            /*
             * Taken from every answer, refusals included, since this is the one
             * moment the information is free.
             *
             * The two branches are the whole of the caching rule, and they differ
             * because an absent header means two different things depending on
             * which token was asked. For a token we have not seen before it is an
             * answer — a classic token has no expiry, and adopting "nothing" is
             * how a rotation onto one clears the warning the old token raised.
             * For the token we already know it is silence rather than an answer:
             * real GitHub repeats the header on every authenticated response, so
             * a reply that omits it is an edge, a proxy or an expired-token 401,
             * and forgetting there would blank the notice on a blip.
             */
            const seen = parseTokenExpiry(response.headers.get(EXPIRY_HEADER))
            const current = fingerprint(token)
            if (known?.fingerprint !== current) known = { fingerprint: current, at: seen }
            else if (seen) known = { fingerprint: current, at: seen }

            if (response.ok || expected.includes(response.status)) return response

            // Logged here rather than at each call site so that both of them are
            // covered: a page that says only "could not read the run history"
            // while Cloud Logging says nothing at all is a dead end.
            const reason = classify(response)
            console.error('GitHub refused a request', { url, status: response.status, reason })
            return reason
        } catch (error) {
            // A transport failure: DNS, TLS, the egress path. Never GitHub's
            // answer, so it cannot be classified from a status code.
            console.error('Could not reach GitHub', { url }, error)
            return 'unavailable'
        }
    }

    return {
        async dispatch(workflow) {
            const result = await call(`${base}/${workflow.file}/dispatches`, {
                method: 'POST',
                body: JSON.stringify({ ref: DISPATCH_REF }),
            })
            if (typeof result === 'string') return { ok: false, reason: result }
            // 204 No Content, with no run id in it. GitHub does not tell the
            // dispatcher which run it created; the UI reads the run list instead.
            return { ok: true }
        },

        async recentRuns(workflow, limit = 5, page = 1, createdSince) {
            // `>`, `=` and the `+` in an offset are all meaningful in a query
            // string, so the whole value is encoded rather than pasted in. The
            // instant is rendered from a Date, so it cannot be the malformed
            // filter that GitHub answers with a cheerful empty list.
            const created = createdSince
                ? `&created=${encodeURIComponent(`>=${createdSince.toISOString()}`)}`
                : ''
            const result = await call(`${base}/${workflow.file}/runs?per_page=${limit}&page=${page}${created}`, {
                method: 'GET',
            })
            if (typeof result === 'string') return { ok: false, reason: result }

            // A 200 whose body is not the JSON it claims to be should degrade to
            // "no history" on the page rather than throwing out of the template
            // and taking the whole page — and its still-working buttons — with it.
            let body: { workflow_runs?: unknown[] }
            try {
                body = (await result.json()) as { workflow_runs?: unknown[] }
            } catch (error) {
                console.error('GitHub returned a run list that could not be parsed', { url: result.url }, error)
                return { ok: false, reason: 'unknown' }
            }

            const runs = (body.workflow_runs ?? []).map((entry) => {
                const run = entry as Record<string, unknown>
                return {
                    status: String(run.status ?? 'unknown'),
                    conclusion: (run.conclusion as string | null) ?? null,
                    startedAt: String(run.run_started_at ?? run.created_at ?? ''),
                    event: String(run.event ?? 'unknown'),
                    runNumber: Number(run.run_number ?? 0),
                    url: String(run.html_url ?? ''),
                }
            })
            return { ok: true, runs }
        },

        async readFile(path, ref = DISPATCH_REF) {
            // `ref` defaults to the same branch dispatches run on, and for the
            // same reason: this service reads and writes the branch the site is
            // built from, and nothing else.
            const url = `${contents}/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`
            const result = await call(url, { method: 'GET' }, [404])
            if (typeof result === 'string') return { ok: false, reason: result }
            if (result.status === 404) return { ok: true, file: { present: false } }

            let body: { content?: unknown; encoding?: unknown; sha?: unknown }
            try {
                body = (await result.json()) as typeof body
            } catch (error) {
                console.error('GitHub returned file contents that could not be parsed', { path }, error)
                return { ok: false, reason: 'unknown' }
            }

            // GitHub answers a directory with an array, and a file over 1MB with
            // `encoding: "none"` and an empty `content`, expecting the blob API
            // instead. Neither is something this can quietly treat as a file: the
            // caller would see empty text and conclude the backup is gone, which
            // is precisely the input the append-only guard exists to refuse.
            if (typeof body.content !== 'string' || typeof body.sha !== 'string' || body.encoding !== 'base64') {
                console.error('GitHub returned something other than a base64 file', {
                    path,
                    encoding: String(body.encoding),
                })
                return { ok: false, reason: 'unknown' }
            }

            return {
                ok: true,
                file: {
                    present: true,
                    text: Buffer.from(body.content, 'base64').toString('utf-8'),
                    sha: body.sha,
                },
            }
        },

        async commitFile(request) {
            const url = `${contents}/${encodeURI(request.path)}`
            const result = await call(
                url,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        branch: DISPATCH_REF,
                        message: request.message,
                        content: Buffer.from(request.text, 'utf-8').toString('base64'),
                        // Omitted entirely rather than sent as null when creating
                        // a file: GitHub rejects an explicit null.
                        ...(request.sha ? { sha: request.sha } : {}),
                        committer: request.committer,
                        // The author is the committer too. A commit written by a
                        // service has no separate author, and leaving it out
                        // makes GitHub attribute it to whoever owns the token —
                        // which is a person, and misleading.
                        author: request.committer,
                    }),
                },
                [409]
            )
            if (typeof result === 'string') return { ok: false, reason: result }
            if (result.status === 409) {
                // Not logged as an error: losing this race is expected and the
                // caller retries. It is logged at all because a *persistent*
                // conflict means something is committing in a loop.
                console.warn('GitHub rejected a commit as conflicting; the file moved under us', {
                    path: request.path,
                })
                return { ok: false, reason: 'conflict' }
            }

            let body: { commit?: { sha?: unknown } }
            try {
                body = (await result.json()) as typeof body
            } catch (error) {
                // The commit landed — this is a 2xx — so reporting failure would
                // be worse than reporting it without a sha to point at.
                console.error('GitHub accepted a commit but returned an unreadable body', { path: request.path }, error)
                return { ok: true, commit: 'unknown' }
            }
            return { ok: true, commit: String(body.commit?.sha ?? 'unknown') }
        },

        tokenExpiry(now = new Date()) {
            const at = known?.at
            if (!at) return undefined
            return { at, daysLeft: Math.trunc((at.getTime() - now.getTime()) / 86_400_000) }
        },
    }
}

/**
 * The client the application uses, built once per instance. Kept lazy for the
 * same reason as the Firestore and Secret Manager clients: importing this module
 * must not require credentials.
 */
let shared: GitHubClient | undefined

export function github(): GitHubClient {
    shared ??= createGitHubClient({ repository, token: githubToken })
    return shared
}

/** What to put in front of a person when a call did not work. */
export const FAILURE_MESSAGES: Record<GitHubFailure, string> = {
    'not-configured': 'No GitHub token is configured for this service, so it cannot start workflows.',
    unauthorized: 'GitHub refused the token. It may have expired, or lost a permission it needs.',
    'not-found': 'GitHub does not recognise that workflow, or the token cannot see this repository.',
    'rate-limited': 'GitHub is rate-limiting this token. Try again shortly.',
    unavailable: 'GitHub could not be reached.',
    unknown: 'GitHub refused the request for an unrecognised reason. The details are in Cloud Logging.',
}
