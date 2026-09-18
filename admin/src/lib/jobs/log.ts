import type { Firestore } from '@google-cloud/firestore'

import { firestore } from '../firestore.ts'
import { trimByAge } from '../retention.ts'

/**
 * What happened, the last few times a job ran.
 *
 * ## Why this exists before anything needs it
 *
 * The Operations page answers "did the last one work, and was it recent enough
 * that pressing this would be pointless" by reading GitHub's run list — see
 * `runs.ts`, which turns a `WorkflowRun` into those two sentences. That works
 * because the work happens in a GitHub Actions run.
 *
 * The moment a job runs inside this service there is no such run, and the page
 * goes blank for precisely the job nobody is yet sure about. So the run log is
 * built with the first job rather than after it.
 *
 * ## It is also where shadow mode reports
 *
 * A job in `dryRun` writes nothing to Firestore and nothing to git. Its entire
 * output is an entry here saying what it *would* have written. That is the whole
 * mechanism by which a week of dual-running produces evidence rather than a
 * feeling, so `changes` is recorded in full rather than counted.
 */

export const RUNS = 'job-runs'

/*
 * How long a run is kept, and the trim that enforces it, live in
 * `lib/retention.ts` — shared with the mirror of GitHub's runs, because the two
 * are one list on the page and a log that is complete down to one date and
 * half-complete below it is worse than either horizon alone.
 */

/** One thing a run changed, in the terms the job itself uses. */
export type Change = {
    /** What changed — a player id, an event id. */
    subject: string
    from: string | undefined
    to: string
}

export type JobRun = {
    slug: string
    startedAt: string
    finishedAt: string
    /** Who asked: an IAP-forwarded email, or the scheduler, or nothing. */
    by: string
    dryRun: boolean
    outcome: 'ok' | 'failed' | 'skipped'
    /**
     * Why, when the outcome is not `ok`. A sentence rather than a code: this is
     * read by a person on the Operations page, and the code is in the logs.
     */
    detail?: string
    changes: Change[]
    /** The commit the backup landed in, when there was one. */
    commit?: string
}

export type RecordOptions = { db?: Firestore; now?: Date }

/**
 * Write one run, and trim the tail.
 *
 * The trim is best-effort and deliberately not part of the caller's success: a
 * run that did its work and then failed to tidy up is a run that worked. It is
 * also why this never throws — a job whose real work succeeded must not be
 * reported as failed because the bookkeeping did not.
 */
export async function record(run: JobRun, options: RecordOptions = {}): Promise<void> {
    const db = options.db ?? firestore()
    try {
        // `${slug}_${startedAt}` rather than an auto id, so a retried tick that
        // somehow records twice overwrites rather than accumulating, and so the
        // document id sorts usefully in the console.
        await db.collection(RUNS).doc(`${run.slug}_${run.startedAt}`).set(defined(run))
        await trimByAge(db, RUNS, options.now ?? new Date())
    } catch (error) {
        console.error('Could not record a job run', { slug: run.slug, outcome: run.outcome }, error)
    }
}

/**
 * The run without its absent optional fields.
 *
 * Firestore rejects `undefined` outright — `Cannot use "undefined" as a
 * Firestore value` — rather than storing a null or skipping the field, and
 * `detail` and `commit` are undefined on exactly the commonest run there is: one
 * that succeeded and has nothing to explain. So the first real shadow run threw
 * here, was swallowed by the `catch` below, and left the Operations page saying
 * "No runs recorded yet" while the job itself had worked perfectly.
 *
 * Stripping the keys rather than turning the whole client's
 * `ignoreUndefinedProperties` on, which would apply to every write this service
 * makes and quietly drop a field somebody meant to set. Absent is also the
 * honest encoding: the schema has these optional, and a run with no detail has
 * no detail rather than a null one.
 */
function defined(run: JobRun): Record<string, unknown> {
    return Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined))
}

/**
 * The most recent runs of *every* job, newest first, for the run log.
 *
 * Separate from `recent` rather than a parameter of it, because it is what the
 * log actually wants: a merged chronology does not care which job a row came
 * from, and asking per job would mean N queries and then throwing most of the
 * answers away.
 *
 * `limit` is what bounds the cost, and it is the caller's business how deep the
 * page goes: at the default this is a hundred document reads against a free tier
 * of fifty thousand a day.
 */
export async function recentAll(limit = 100, options: RecordOptions = {}): Promise<JobRun[]> {
    const db = options.db ?? firestore()
    try {
        const snapshot = await db.collection(RUNS).orderBy('startedAt', 'desc').limit(limit).get()
        return snapshot.docs.map((document) => document.data() as JobRun)
    } catch (error) {
        console.error('Could not read the job run history', error)
        return []
    }
}

/**
 * The most recent runs of one job, newest first: for the card that summarises it
 * on the Operations page, and for the run log narrowed to that job alone.
 */
export async function recent(slug: string, limit = 5, options: RecordOptions = {}): Promise<JobRun[]> {
    const db = options.db ?? firestore()
    try {
        const snapshot = await db
            .collection(RUNS)
            .where('slug', '==', slug)
            .orderBy('startedAt', 'desc')
            .limit(limit)
            .get()
        return snapshot.docs.map((document) => document.data() as JobRun)
    } catch (error) {
        // Degrades to "no history" on the page rather than taking the page down,
        // which is the same choice `recentRuns` makes about GitHub.
        console.error('Could not read the job run history', { slug }, error)
        return []
    }
}
