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
 * How many runs to ask for when checking whether anything is new.
 *
 * This is the number that decides what the Operations page costs, and getting it
 * wrong is what made the page take ten seconds to render. A page of a hundred
 * runs is **1.5 MB** of JSON from GitHub — a run object carries its repository,
 * head repository and head commit, so it is around 15 kB on its own — and
 * fetching that per workflow means seven megabytes downloaded and parsed to
 * discover, almost always, that nothing has run since the last visit.
 *
 * The mirror is what makes a small page enough: everything below the high-water
 * mark is already held, so a probe only has to reach back far enough to *find*
 * that mark. Ten runs is a day and a half at six runs a day, against a tick that
 * syncs four times a day, so the probe reaches it every time in practice — and
 * when it does not, the full walk below is still there to catch up.
 */
export const PROBE_PAGE = 10

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
    runs?: (
        workflow: DispatchableWorkflow,
        page: number,
        perPage: number
    ) => Promise<{ ok: true; runs: WorkflowRun[] } | { ok: false; reason: GitHubFailure }>
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
        options.runs ??
        ((workflow: DispatchableWorkflow, page: number, perPage: number) =>
            github().recentRuns(workflow, perPage, page))

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

    /*
     * In parallel, because the workflows are independent and this runs while
     * somebody waits for a page.
     *
     * It was a `for ... await` loop to begin with, which is the same five round
     * trips one after another rather than at once — and the comment on the call
     * site claimed parallelism the code did not have. Five serial requests is the
     * other half of why the Operations page went from one second to ten.
     */
    const outcomes = await Promise.all(
        workflows.map(async (workflow) => {
            try {
                return await one(db, workflow, {
                    maxPages,
                    read,
                    pending: unfinished.get(workflow.slug) ?? new Set(),
                })
            } catch (error) {
                console.error('Could not mirror a workflow history', { workflow: workflow.slug }, error)
                return { stored: 0, fetched: 0, failure: 'unknown' as const, slug: workflow.slug }
            }
        })
    )

    const failures = outcomes.flatMap((outcome, index) =>
        outcome.failure ? [{ slug: workflows[index]!.slug, reason: outcome.failure }] : []
    )
    const stored = outcomes.reduce((total, outcome) => total + outcome.stored, 0)
    const fetched = outcomes.reduce((total, outcome) => total + outcome.fetched, 0)

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

    let fetched = 0
    const wanted = (runs: readonly WorkflowRun[]) =>
        runs.filter((run) => run.runNumber > newest || options.pending.has(run.runNumber))

    /*
     * The probe, and the reason this is not just the loop below with a smaller
     * number: almost every sync is a question with the answer "nothing", and the
     * cheapest way to ask it is a page barely longer than the gap it is checking.
     * See `PROBE_PAGE` for what the alternative costs.
     *
     * Skipped when there is no high-water mark to find, which is a workflow being
     * seeded — that one wants the big pages, since it is going to read the whole
     * history either way.
     */
    if (newest > 0) {
        const probe = await options.read(workflow, 1, PROBE_PAGE)
        fetched += 1
        if (!probe.ok) return { stored: 0, fetched, failure: probe.reason }

        // Reached what we hold, or reached the end of a history shorter than the
        // probe. Either way there is nothing above this page left to find.
        const enough = probe.runs.some((run) => run.runNumber <= newest) || probe.runs.length < PROBE_PAGE

        /*
         * Unless something we marked in flight is older than the probe can see.
         *
         * That run would otherwise never be looked at again: it is below the
         * high-water mark, so nothing makes it new, and below the probe, so
         * nothing fetches it. The row would sit at `queued` for good, and the
         * pending query would carry it forever. Rare — a run is normally
         * refreshed by the very next sync, while it is still near the top — but
         * permanent when it happens, so it is worth one full walk to repair.
         */
        const lowest = probe.runs.at(-1)?.runNumber ?? 0
        const stranded =
            probe.runs.length === PROBE_PAGE && [...options.pending].some((number) => number < lowest)

        if (enough && !stranded) {
            const writes = wanted(probe.runs).map((run) => asStored(run, workflow.slug))
            return { stored: await store(db, writes), fetched }
        }
        // More than a probe's worth has happened since the last sync — a service
        // asleep for days, or a workflow somebody ran in a loop. Fall through and
        // walk it properly, from the top: these ten are re-read as part of the
        // first full page rather than carried over, so nothing is written twice.
    }

    const writes: StoredWorkflowRun[] = []

    for (let page = 1; page <= options.maxPages; page += 1) {
        const outcome = await options.read(workflow, page, PER_PAGE)
        fetched += 1
        if (!outcome.ok) {
            // What has already been collected is still written: a rate limit on
            // page three should not throw away pages one and two.
            const stored = await store(db, writes)
            return { stored, fetched, failure: outcome.reason }
        }

        writes.push(...wanted(outcome.runs).map((run) => asStored(run, workflow.slug)))

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
 * number, so it reads the same way the log's own queries do and is served by the
 * one index `terraform/firestore.tf` declares, rather than wanting a second one
 * of its own. The two orders agree: GitHub numbers runs in the order it creates
 * them.
 *
 * This is the query the mirror makes most often — once per workflow, on every
 * page load and every tick — which is what makes that index worth declaring at
 * all on a database whose edition needs none of them.
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
