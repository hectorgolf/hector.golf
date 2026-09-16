import type { Firestore } from '@google-cloud/firestore'

import { firestore } from '../firestore.ts'

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

/**
 * How many entries to keep per job.
 *
 * Trimmed rather than kept forever, unlike the observation log this service
 * writes. The distinction is the one `handicap-checks.json` already draws: the
 * observations are the data and are kept for good; this is operational history,
 * useful for days rather than years, and at six runs a day an untrimmed
 * collection is 2,200 documents a year per job for a page that shows five.
 */
export const KEEP_PER_JOB = 50

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

export type RecordOptions = { db?: Firestore }

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
        await db.collection(RUNS).doc(`${run.slug}_${run.startedAt}`).set(run)
        await trim(db, run.slug)
    } catch (error) {
        console.error('Could not record a job run', { slug: run.slug, outcome: run.outcome }, error)
    }
}

async function trim(db: Firestore, slug: string): Promise<void> {
    const snapshot = await db
        .collection(RUNS)
        .where('slug', '==', slug)
        .orderBy('startedAt', 'desc')
        .offset(KEEP_PER_JOB)
        .get()
    if (snapshot.empty) return

    const batch = db.batch()
    for (const document of snapshot.docs) batch.delete(document.ref)
    await batch.commit()
}

/** The most recent runs of one job, newest first, for the Operations page. */
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
