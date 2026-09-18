import { github } from '../github.ts'
import { guard } from './backup.ts'
import * as handicaps from './handicaps.ts'
import type { Change } from './log.ts'

/**
 * The jobs this service runs itself, as opposed to the workflows it asks GitHub
 * to run.
 *
 * ## Why there are two lists
 *
 * `workflows.ts` is the list of things GitHub does; this is the list of things
 * this process does. They are deliberately separate rather than one list with a
 * flag, because during the migration a dataset appears in *both* — the old
 * workflow still scraping and committing, the new job shadowing it — and a
 * single list would have to represent that as a contradiction.
 *
 * The plan is for entries to move from there to here, one dataset at a time,
 * with the workflow entry deleted only once the job has replaced everything the
 * workflow wrote. For handicaps that is four outputs, not one; see the table in
 * `docs/plans/handicaps-to-firestore.md`.
 */

export type Job = {
    slug: string
    label: string
    blurb: string
    /**
     * Whether the job writes anything yet.
     *
     * `true` means shadow mode: reconcile, scrape, compute, report — and touch
     * neither Firestore nor git. It is a property of the job rather than a
     * parameter of the request on purpose. A caller able to ask for real writes
     * is a caller able to end the shadow period by accident, and the whole value
     * of the shadow period is that it ends on a deliberate commit that somebody
     * reviewed.
     */
    dryRun: boolean
    /**
     * Whether the Cloud Scheduler tick runs this one.
     *
     * The same flag `workflows.ts` carries, and deliberately the same word: the
     * schedule's two jobs call one endpoint, which starts everything marked
     * `scheduled` — workflows on GitHub and jobs in this process alike. Adding
     * either to the tick is an entry in a list rather than an infrastructure
     * change, which is what keeps `terraform/scheduler.tf` down to two jobs.
     */
    scheduled: boolean
    /**
     * Whether the site builds from what this job writes.
     *
     * A job that says yes asks for a deploy when it changes something, because
     * nothing else will: the backup it commits lives outside `astrosite/`, which
     * is deliberate — see `BACKUP_PATH` — and so it is outside
     * `deploy-site.yml`'s path filter too. Before step 3 that cost nothing,
     * since the site still built from `handicaps.json` and the old workflow
     * dispatched its own deploy. Once the build reads the API, a change sitting
     * in Firestore with nothing rebuilding the site is a published page that is
     * quietly a day out of date.
     *
     * A flag rather than a rule about all jobs, because the next ones are not
     * all like this: a job that only maintains internal state has nothing to
     * publish and should not be spending a deploy on it.
     */
    publishes: boolean
    run(dryRun: boolean): Promise<JobOutcome>
}

export type JobOutcome = {
    /**
     * `skipped` is a run that did not happen, as distinct from one that happened
     * and went wrong. `execute.ts` already used it for a run dropped because
     * another holds the lease; a job may now also report it for itself, which is
     * what a missing credential is — nothing was attempted, so there is nothing
     * to have failed.
     */
    outcome: 'ok' | 'failed' | 'skipped'
    detail?: string
    changes: Change[]
    commit?: string
}

/**
 * Thrown when a job cannot start because something it needs was never set up.
 *
 * Deliberately not a failure. `GitHubFailure`'s own documentation calls
 * `not-configured` "expected before the setup step that creates one", and a
 * fresh project meets it on every tick until somebody puts a token in — so
 * treating it as a crash means a stack trace at error level, four times a day,
 * for a
 * state the deployment is documented to pass through. The reliable effect of
 * that is not urgency; it is people learning that this service's error logs are
 * noise.
 *
 * It is distinct from an outage on purpose, and the distinction is load-bearing
 * rather than cosmetic: `readFile` below throws on *every* failed read because
 * the reconcile reads `undefined` as "the old pipeline has written nothing", and
 * an unreachable GitHub reported that way would let a run conclude the legacy
 * file was empty and commit over it. `not-configured` is the one reason that
 * cannot be an outage — it is decided before a request is made — so it is the
 * one reason that can safely mean something other than "stop, loudly".
 */
export class NotConfigured extends Error {
    /**
     * Duck-typed rather than left to `instanceof`, which compares constructors:
     * this module is loaded by Vite in development and from a bundle in
     * production, and a second copy of it would make the check quietly false —
     * turning every missing credential back into the stack trace this exists to
     * stop, in the one environment that cannot be watched.
     */
    readonly notConfigured = true

    constructor(what: string) {
        super(`${what} needs a GitHub token, and this service has none configured`)
        this.name = 'NotConfigured'
    }
}

export const isNotConfigured = (error: unknown): error is NotConfigured =>
    error instanceof Error && (error as { notConfigured?: unknown }).notConfigured === true

/**
 * Who the commits are attributed to.
 *
 * Matches the convention the workflows use — `GIT_AUTHOR_NAME` is the workflow's
 * own file name — so that `git log` keeps answering "what wrote this" with a
 * name that can be looked up. The email is the one the workflows already commit
 * under, supplied the same way.
 */
const COMMITTER = {
    name: 'hector-admin',
    email: process.env.GIT_COMMITTER_EMAIL ?? 'noreply@hector.golf',
}

/**
 * How many times to re-read and retry a commit that lost a race.
 *
 * Three, because the thing being raced against is the four data-update
 * workflows' `git pull -r && git push`, which happens once per workflow per tick
 * — so losing three times in a row means something is committing in a loop, and
 * retrying further would join it.
 */
const COMMIT_ATTEMPTS = 3

/**
 * Read a file from `main`, or `undefined` when it is not there.
 *
 * A read that *fails* throws rather than returning undefined, which matters more
 * than it looks: the reconcile treats undefined as "the old pipeline has not
 * written anything", and a GitHub outage that reported itself that way would let
 * a run conclude the legacy file was empty.
 */
async function readFile(path: string): Promise<string | undefined> {
    const result = await github().readFile(path)
    if (!result.ok) {
        // The one reason that is a missing setup step rather than a fault. See
        // `NotConfigured` for why it is worth telling apart, and why every other
        // reason still has to be fatal to the run.
        if (result.reason === 'not-configured') throw new NotConfigured(`reading ${path}`)
        throw new Error(`Could not read ${path} from GitHub: ${result.reason}`)
    }
    return result.file.present ? result.file.text : undefined
}

/**
 * Commit a rendered backup, behind the append-only guard, retrying a lost race.
 *
 * The guard runs against a freshly read copy on every attempt rather than once
 * before the loop: the point of a retry is that the file changed, so checking
 * the render against the *old* contents would wave through exactly the case the
 * guard exists for.
 */
async function commit(
    path: string,
    text: string,
    message: string
): Promise<{ ok: true; commit: string } | { ok: false; detail: string }> {
    for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt += 1) {
        const existing = await github().readFile(path)
        if (!existing.ok) return { ok: false, detail: `could not read ${path}: ${existing.reason}` }

        const before = existing.file.present ? existing.file.text : undefined
        const verdict = guard(before, text)

        if (verdict.verdict === 'unchanged') {
            return { ok: true, commit: 'unchanged' }
        }
        if (verdict.verdict === 'refuse') {
            // Loud, and fatal to the run. This is the alarm the guard exists to
            // raise: something rewrote history, and committing it would destroy
            // the only copy that could have proved it.
            console.error('Refusing to commit a backup that is not an append', { path, detail: verdict.detail })
            return { ok: false, detail: `refused to commit ${path}: ${verdict.detail}` }
        }

        const written = await github().commitFile({
            path,
            text,
            message,
            sha: existing.file.present ? existing.file.sha : undefined,
            committer: COMMITTER,
        })
        if (written.ok) return { ok: true, commit: written.commit }
        if (written.reason !== 'conflict') return { ok: false, detail: `could not commit ${path}: ${written.reason}` }

        console.warn(`Commit of ${path} lost a race; re-reading and retrying`, { attempt })
    }
    return { ok: false, detail: `could not commit ${path}: lost the race ${COMMIT_ATTEMPTS} times` }
}

export const JOBS: readonly Job[] = [
    {
        slug: 'handicaps',
        label: "Players' official handicaps",
        blurb: "Reads every player's current handicap from WiseGolf into Firestore, and keeps the git backup in step.",
        // Live since 2026-09-18, which is step 2 of the plan. The bar written
        // here was "a week of boring diffs"; what it actually got was two days
        // and a single paired decision, and the plan explains why that was the
        // right trade — the changes stop for the season in October, so a week of
        // waiting risked buying no evidence at all rather than more of it.
        //
        // What the one pair proved is the part that could not be proved offline:
        // on 2026-09-18 at 05:00 UTC this job read `handicaps.json`, scraped, and
        // said `sami-h` 4.8 -> 5.2 thirty-one seconds before the workflow
        // committed the identical change. It reached that answer without having
        // been told it, which is the whole of what the shadow period was for.
        dryRun: false,
        // On the tick from the start, because shadow mode is only worth anything
        // if it runs as often as the thing it is shadowing. The tick also
        // dispatches `update-handicaps.yml`, so each run produces a pair of
        // decisions made against the same base state — see the note in
        // `api/workflows/dispatch.ts` on why that ordering is what makes the
        // comparison meaningful.
        scheduled: true,
        // The site reads `/api/handicaps/history` as of step 3, so a handicap
        // this job finds has to reach a rebuilt page somehow.
        publishes: true,
        run: (dryRun) => handicaps.run({ readFile, commit, now: () => new Date() }, dryRun),
    },
]

/** What the scheduled tick runs in this process, in the order it runs them. */
export const SCHEDULED_JOBS: readonly Job[] = JOBS.filter((job) => job.scheduled)

export function jobBySlug(slug: string | undefined): Job | undefined {
    return JOBS.find((job) => job.slug === slug)
}
