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
    run(dryRun: boolean): Promise<JobOutcome>
}

export type JobOutcome = {
    outcome: 'ok' | 'failed'
    detail?: string
    changes: Change[]
    commit?: string
}

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
    if (!result.ok) throw new Error(`Could not read ${path} from GitHub: ${result.reason}`)
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
        // Shadow mode. Step 2 of the plan flips this, in its own commit, once the
        // run log has shown a week of boring diffs.
        dryRun: true,
        run: (dryRun) => handicaps.run({ readFile, commit, now: () => new Date() }, dryRun),
    },
]

export function jobBySlug(slug: string | undefined): Job | undefined {
    return JOBS.find((job) => job.slug === slug)
}
