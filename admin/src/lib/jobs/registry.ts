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
    /**
     * Whether something this run committed will start a deploy by itself.
     *
     * True when a commit landed inside `astrosite/`, which `deploy-site.yml`
     * watches — and which a commit made with this service's token does trigger,
     * unlike one made with `GITHUB_TOKEN`. `publish()` reads it to avoid asking
     * for a second build of the same commit.
     */
    deployStartsItself?: boolean
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
 *
 * A run now writes more files than the two backups this number was chosen for:
 * the bucket recompute can touch an event file per open Hector. The number still
 * holds, and it holds for the same reason rather than by luck — the retry budget
 * is per file, and what it is racing is unchanged at one push per workflow per
 * tick. What grew is how many files are exposed to that race, not how often it
 * happens, and in practice a tick changes the buckets of zero or one event.
 */
const COMMIT_ATTEMPTS = 3

/**
 * The files in a directory on `main`.
 *
 * Throws on any failure, including a directory that is not there — see
 * `ListDirectoryOutcome` for why absence is not an answer here. A recompute that
 * read "no events" from a failed lookup would leave every split stale and report
 * success.
 */
async function listDirectory(path: string): Promise<string[]> {
    const result = await github().listDirectory(path)
    if (!result.ok) {
        if (result.reason === 'not-configured') throw new NotConfigured(`listing ${path}`)
        throw new Error(`Could not list ${path} on GitHub: ${result.reason}`)
    }
    return result.files
}

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

/** What a writer wants done with a file, given how it currently stands. */
export type Decision =
    /** Commit this text. */
    | { write: string }
    /** Nothing to do. Reported as a successful no-op. */
    | { skip: true }
    /** Do not commit, and fail the run. `refuse` is a sentence for the run log. */
    | { refuse: string }

export type CommitOutcome = { ok: true; commit: string } | { ok: false; detail: string }

/**
 * Commit a file, deciding what to write against a freshly read copy each attempt.
 *
 * The decision is taken *inside* the retry loop, and that is the whole shape of
 * this function rather than an implementation detail. The reason a retry happens
 * is that the file changed underneath us, so deciding once before the loop would
 * re-submit an answer computed against contents that no longer exist — which for
 * the append-only guard means waving through exactly the case it exists to catch.
 *
 * Split out from `commit` below when the bucket recompute needed the retry
 * without the guard. The two callers differ only in what they decide, which is
 * the argument.
 */
async function commitWith(
    path: string,
    message: string,
    decide: (before: string | undefined) => Decision
): Promise<CommitOutcome> {
    for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt += 1) {
        const existing = await github().readFile(path)
        if (!existing.ok) return { ok: false, detail: `could not read ${path}: ${existing.reason}` }

        const before = existing.file.present ? existing.file.text : undefined
        const decision = decide(before)

        if ('skip' in decision) return { ok: true, commit: 'unchanged' }
        if ('refuse' in decision) return { ok: false, detail: `refused to commit ${path}: ${decision.refuse}` }

        const written = await github().commitFile({
            path,
            text: decision.write,
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

/**
 * The rule for a file whose history is the content: append, or refuse.
 *
 * `path` is only for the log line. Exported for the tests, which is also how the
 * difference between this and `wholesale` stays a thing somebody can read.
 */
export const appendOnly =
    (text: string, path: string) =>
    (before: string | undefined): Decision => {
        const verdict = guard(before, text)
        if (verdict.verdict === 'unchanged') return { skip: true }
        if (verdict.verdict === 'refuse') {
            // Loud, and fatal to the run. This is the alarm the guard exists to
            // raise: something rewrote history, and committing it would destroy
            // the only copy that could have proved it.
            console.error('Refusing to commit a backup that is not an append', { path, detail: verdict.detail })
            return { refuse: verdict.detail }
        }
        return { write: text }
    }

/**
 * The rule for a file this service rewrites in full, such as an event's buckets.
 *
 * No guard, and the reason is a property of the file rather than a relaxation.
 * An event's JSON is a current-state document whose previous versions live in
 * git, where a bad write is a revert — the same reasoning `data-ownership.md`
 * gives for the repository being the database. That is exactly what does *not*
 * hold for the observation logs: an append-only file that gets rewritten has
 * lost the only copy of what it used to say, and there is nothing to revert to
 * that the rewrite did not also produce.
 *
 * Identical text is a no-op rather than an empty commit, which is what keeps a
 * tick that changed nothing from adding a commit per open event.
 */
export const wholesale =
    (text: string) =>
    (before: string | undefined): Decision =>
        before === text ? { skip: true } : { write: text }

/** Commit a rendered backup, behind the append-only guard. */
async function commit(path: string, text: string, message: string): Promise<CommitOutcome> {
    return commitWith(path, message, appendOnly(text, path))
}

/** Commit a file this service owns outright, replacing whatever is there. */
export async function replace(path: string, text: string, message: string): Promise<CommitOutcome> {
    return commitWith(path, message, wholesale(text))
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
        // On the tick, which since 2026-09-20 is the only thing that reads a
        // handicap at all: `update-handicaps.yml` was deleted once this job had
        // replaced its fourth and last output, the event buckets.
        scheduled: true,
        // The site reads `/api/handicaps/history` as of step 3, so a handicap
        // this job finds has to reach a rebuilt page somehow.
        publishes: true,
        run: (dryRun) => handicaps.run({ readFile, listDirectory, commit, replace, now: () => new Date() }, dryRun),
    },
]

/** What the scheduled tick runs in this process, in the order it runs them. */
export const SCHEDULED_JOBS: readonly Job[] = JOBS.filter((job) => job.scheduled)

export function jobBySlug(slug: string | undefined): Job | undefined {
    return JOBS.find((job) => job.slug === slug)
}
