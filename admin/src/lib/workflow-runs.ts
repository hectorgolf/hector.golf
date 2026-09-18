import type { Firestore } from '@google-cloud/firestore'

import { firestore } from './firestore.ts'
import { github, type GitHubFailure, type WorkflowRun } from './github.ts'
import { trimByAge } from './retention.ts'
import type { DispatchableWorkflow } from './workflows.ts'

/**
 * A copy of GitHub's run history, kept in Firestore.
 *
 * ## Why mirror it at all
 *
 * The Operations page used to read GitHub live on every load, which answers
 * "what happened last night" well and "what happened in July" not at all: the
 * run list is paged at 100, so any view deeper than that costs a loop of
 * requests, and GitHub deletes runs after 90 days anyway. Meanwhile the jobs
 * this service runs itself were already recorded here, so half the log was
 * durable and queryable and the other half was neither.
 *
 * Mirroring makes the two halves the same kind of thing. The page then reads one
 * database rather than one database and five HTTP calls, pages as deep as the
 * retention goes, and — the part that only a copy can do — keeps runs that
 * GitHub has since thrown away.
 *
 * ## Why the sync is cheap
 *
 * Because run numbers only ever go up. A sync asks GitHub for the newest page,
 * writes the runs above the highest one already held, and stops as soon as the
 * page contains a run it has seen before — which, at six runs a day against a
 * page of a hundred, is on the first page every time after the first. A workflow
 * nobody has synced before has no "seen before" to stop at, so the same loop
 * seeds the archive by paging back until GitHub runs out.
 *
 * The only runs that need rewriting rather than adding are the ones that were
 * still going when they were last seen, and they are found by asking for them:
 * `pending` is set while a run is not `completed` and gone once it is, so one
 * small query finds everything whose conclusion is still unknown.
 */

export const RUNS = 'workflow-runs'

/** GitHub's maximum page size, and therefore the only one worth asking for. */
export const PER_PAGE = 100

/**
 * How many pages of one workflow's history a sync may fetch.
 *
 * Two numbers because two callers with different budgets. A page render spends
 * `FORWARD_PAGES`, which covers the normal case — a single page, containing runs
 * we already hold — with room for a gap left by a service that was asleep for a
 * few days. The tick spends `SEED_PAGES`, because it is the one that meets a
 * workflow for the first time and has to bring back everything GitHub still has:
 * a thousand runs is about six months at this repository's rate, comfortably
 * past the 90 days GitHub keeps, so the archive starts complete rather than
 * filling in from today.
 */
export const FORWARD_PAGES = 3
export const SEED_PAGES = 10

/**
 * A run as we keep it: GitHub's own fields, plus which workflow it belongs to.
 *
 * `slug` rather than the workflow's file name, because the slug is what the
 * pages, the filter and the API routes all name a workflow by, and the file name
 * is an implementation detail of the dispatch API.
 */
export type StoredWorkflowRun = WorkflowRun & {
    slug: string
    /**
     * Present, and `true`, exactly while the run has not finished.
     *
     * A field that comes and goes rather than a boolean that is always there, so
     * that `where('pending', '==', true)` matches only the handful of runs whose
     * outcome is still unknown — a document without the field is not a candidate
     * at all. That keeps the "what changed since last time" query proportional to
     * the runs in flight rather than to the archive.
     */
    pending?: true
}

export type SyncOptions = {
    db?: Firestore
    now?: Date
    /** How many pages of one workflow's list this sync may fetch. */
    maxPages?: number
    /** Injectable so the sync can be tested without a fetch. */
    runs?: (workflow: DispatchableWorkflow, page: number) => Promise<
        { ok: true; runs: WorkflowRun[] } | { ok: false; reason: GitHubFailure }
    >
}

export type SyncResult = {
    /** Why a workflow's history could not be read, when one could not. */
    failures: { slug: string; reason: GitHubFailure }[]
    /** How many runs were written, which is 0 on a tick where nothing has run. */
    stored: number
    /** How many pages were fetched, across all workflows. Seeding is the only time this is large. */
    fetched: number
}

/** The document id. Run numbers are unique within a workflow and never reused. */
const idOf = (run: StoredWorkflowRun): string => `${run.slug}_${run.runNumber}`

const asStored = (run: WorkflowRun, slug: string): StoredWorkflowRun => ({
    slug,
    status: run.status,
    conclusion: run.conclusion,
    startedAt: run.startedAt,
    event: run.event,
    runNumber: run.runNumber,
    url: run.url,
    // Spelled this way rather than `pending: run.status !== 'completed'` because
    // the field has to be *absent* on a finished run: the write below replaces
    // the document, so a `false` would linger as something the pending query has
    // to read and discard on every sync thereafter.
    ...(run.status === 'completed' ? {} : { pending: true as const }),
})

/**
 * Bring the mirror up to date with GitHub, and report what could not be read.
 *
 * Never throws. This runs on page loads and on the tick, and in both places the
 * useful behaviour when GitHub is unreachable is to render or dispatch from what
 * is already stored — which is strictly better than the live reads this
 * replaced, where an unreachable GitHub emptied the log.
 */
export async function sync(
    workflows: readonly DispatchableWorkflow[],
    options: SyncOptions = {}
): Promise<SyncResult> {
    const db = options.db ?? firestore()
    const now = options.now ?? new Date()
    const maxPages = options.maxPages ?? FORWARD_PAGES
    const read =
        options.runs ?? ((workflow: DispatchableWorkflow, page: number) => github().recentRuns(workflow, PER_PAGE, page))

    const failures: SyncResult['failures'] = []
    let stored = 0
    let fetched = 0

    let unfinished: Map<string, Set<number>>
    try {
        unfinished = await pending(db)
    } catch (error) {
        // Not fatal: without it a run that was in flight when last seen keeps its
        // old status until something else rewrites it, which is a stale pill
        // rather than a broken page.
        console.error('Could not read the in-flight workflow runs', error)
        unfinished = new Map()
    }

    for (const workflow of workflows) {
        try {
            const outcome = await one(db, workflow, {
                maxPages,
                read,
                pending: unfinished.get(workflow.slug) ?? new Set(),
            })
            stored += outcome.stored
            fetched += outcome.fetched
            if (outcome.failure) failures.push({ slug: workflow.slug, reason: outcome.failure })
        } catch (error) {
            console.error('Could not mirror a workflow history', { workflow: workflow.slug }, error)
            failures.push({ slug: workflow.slug, reason: 'unknown' })
        }
    }

    try {
        await trimByAge(db, RUNS, now)
    } catch (error) {
        // Best effort, like the job log's: a mirror that is up to date and then
        // fails to tidy up is a mirror that worked.
        console.error('Could not trim the workflow run mirror', error)
    }

    return { failures, stored, fetched }
}

async function one(
    db: Firestore,
    workflow: DispatchableWorkflow,
    options: {
        maxPages: number
        read: NonNullable<SyncOptions['runs']>
        pending: Set<number>
    }
): Promise<{ stored: number; fetched: number; failure?: GitHubFailure }> {
    /*
     * The high-water mark: everything above it is new, everything at or below it
     * is something we have already written.
     *
     * Read from the archive rather than from a cursor document kept beside it. A
     * cursor is one read either way, and this one cannot drift — a cursor that
     * was written when the run beneath it was not would make the sync skip a run
     * for good, silently, which is the one failure mode an archive must not have.
     *
     * Zero when there is nothing stored, which is what makes the loop below seed:
     * no run can be at or below it, so it keeps paging until GitHub runs out.
     */
    const newest = await newestRunNumber(db, workflow.slug)

    const writes: StoredWorkflowRun[] = []
    let fetched = 0

    for (let page = 1; page <= options.maxPages; page += 1) {
        const outcome = await options.read(workflow, page)
        fetched += 1
        if (!outcome.ok) {
            // What has already been collected is still written: a rate limit on
            // page three should not throw away pages one and two.
            const stored = await store(db, writes)
            return { stored, fetched, failure: outcome.reason }
        }

        for (const run of outcome.runs) {
            if (run.runNumber > newest || options.pending.has(run.runNumber)) {
                writes.push(asStored(run, workflow.slug))
            }
        }

        // The stop the whole design is for: the page reached back into what we
        // already hold, so everything below it is held too.
        if (outcome.runs.some((run) => run.runNumber <= newest)) break
        // GitHub had nothing more to give. Only reachable while seeding, and it
        // is what makes the first sync end at the bottom of the history rather
        // than at the page budget.
        if (outcome.runs.length < PER_PAGE) break
    }

    return { stored: await store(db, writes), fetched }
}

/**
 * The highest run number held for one workflow.
 *
 * Found through the newest *start time* rather than by ordering on the run
 * number, so this uses the same (slug, startedAt) index the log's own reads
 * need — see `terraform/firestore.tf` — rather than asking for a second index
 * for one query. The two orders agree: GitHub numbers runs in the order it
 * creates them.
 */
async function newestRunNumber(db: Firestore, slug: string): Promise<number> {
    const snapshot = await db
        .collection(RUNS)
        .where('slug', '==', slug)
        .orderBy('startedAt', 'desc')
        .limit(1)
        .get()
    const newest = snapshot.docs[0]?.data() as StoredWorkflowRun | undefined
    return newest?.runNumber ?? 0
}

/** Which runs were still going when they were last seen, by workflow. */
async function pending(db: Firestore): Promise<Map<string, Set<number>>> {
    const snapshot = await db.collection(RUNS).where('pending', '==', true).get()
    const byWorkflow = new Map<string, Set<number>>()
    for (const document of snapshot.docs) {
        const run = document.data() as StoredWorkflowRun
        const numbers = byWorkflow.get(run.slug) ?? new Set<number>()
        numbers.add(run.runNumber)
        byWorkflow.set(run.slug, numbers)
    }
    return byWorkflow
}

/**
 * Write a batch of runs, in chunks Firestore will accept.
 *
 * `set` rather than `create`, so a run that was `queued` last time is replaced
 * by the same run `completed` — and so a sync that overlaps another one writes
 * the same document twice rather than failing.
 */
async function store(db: Firestore, runs: readonly StoredWorkflowRun[]): Promise<number> {
    const LIMIT = 500
    for (let from = 0; from < runs.length; from += LIMIT) {
        const batch = db.batch()
        for (const run of runs.slice(from, from + LIMIT)) {
            batch.set(db.collection(RUNS).doc(idOf(run)), run)
        }
        await batch.commit()
    }
    return runs.length
}

export type ReadOptions = { db?: Firestore }

/**
 * The most recent runs of every workflow, newest first.
 *
 * Degrades to "no history" rather than taking the page down, which is the same
 * choice the job log makes and the same one the live GitHub read made before it.
 */
export async function recentAll(limit = 100, options: ReadOptions = {}): Promise<StoredWorkflowRun[]> {
    const db = options.db ?? firestore()
    try {
        const snapshot = await db.collection(RUNS).orderBy('startedAt', 'desc').limit(limit).get()
        return snapshot.docs.map((document) => document.data() as StoredWorkflowRun)
    } catch (error) {
        console.error('Could not read the workflow run mirror', error)
        return []
    }
}

/** The most recent runs of one workflow, newest first, for the log narrowed to it. */
export async function recent(slug: string, limit = 100, options: ReadOptions = {}): Promise<StoredWorkflowRun[]> {
    const db = options.db ?? firestore()
    try {
        const snapshot = await db
            .collection(RUNS)
            .where('slug', '==', slug)
            .orderBy('startedAt', 'desc')
            .limit(limit)
            .get()
        return snapshot.docs.map((document) => document.data() as StoredWorkflowRun)
    } catch (error) {
        console.error('Could not read the workflow run mirror', { slug }, error)
        return []
    }
}
