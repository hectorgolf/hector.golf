import { githubToken } from './secrets.ts'
import { DISPATCH_REF, type DispatchableWorkflow } from './workflows.ts'

/**
 * The slice of GitHub's REST API this service uses: start a workflow, and say
 * when it last ran.
 *
 * Written against `fetch` rather than Octokit. Two calls do not justify a
 * dependency whose job is the other two hundred, and this way the container has
 * one fewer thing to install and audit.
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

export type GitHubClient = {
    dispatch(workflow: DispatchableWorkflow): Promise<DispatchOutcome>
    recentRuns(workflow: DispatchableWorkflow, limit?: number): Promise<RunsOutcome>
}

const API = 'https://api.github.com'

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
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
    const doFetch = options.fetch ?? globalThis.fetch
    const base = `${API}/repos/${options.repository}/actions/workflows`

    /** Everything both calls do the same way: get a token, call, classify. */
    async function call(url: string, init: RequestInit): Promise<Response | GitHubFailure> {
        const token = await options.token()
        if (!token) return 'not-configured'

        try {
            const response = await doFetch(url, { ...init, headers: headers(token) })
            if (response.ok) return response

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

        async recentRuns(workflow, limit = 5) {
            const result = await call(`${base}/${workflow.file}/runs?per_page=${limit}`, { method: 'GET' })
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
    unauthorized: 'GitHub refused the token. It may have expired or lost its Actions permission.',
    'not-found': 'GitHub does not recognise that workflow, or the token cannot see this repository.',
    'rate-limited': 'GitHub is rate-limiting this token. Try again shortly.',
    unavailable: 'GitHub could not be reached.',
    unknown: 'GitHub refused the request for an unrecognised reason. The details are in Cloud Logging.',
}
