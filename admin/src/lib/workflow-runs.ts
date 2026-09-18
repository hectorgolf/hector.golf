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

/** Where the "when did we last ask" marks live: one document, all workflows. */
export const SYNC_STATE = 'workflow-sync'
export const SYNC_STATE_DOC = 'state'

/**
 * How recently a workflow must have been asked about for a sync to skip it.
 *
 * The Operations page syncs on every load, which is what keeps it current and
 * also what makes a reload, a back button and a double-click three requests to
 * GitHub for an answer that cannot have changed. Ten seconds is shorter than any
 * run takes to appear in GitHub's list — the page already says a dispatched run
 * takes a minute or two to show up — so nothing becomes less true, and a burst of
 * page loads costs one call instead of one each.
 */
export const MIN_SYNC_INTERVAL_MS = 10_000

/**
 * How far before the last sync the next one starts looking.
 *
 * The window is built from our clock and applied against GitHub's, and a run
 * created in the seconds either side of a request must not fall between the two.
 * Overlap is the cheap direction: a run we already hold costs one idempotent
 * write, while a run nobody asks for again is a hole in the archive that nothing
 * will ever repair.
 *
 * Five minutes is far more skew than two machines on NTP will ever show, and at
 * six runs a day it widens the usual answer from nothing to nothing.
 */
export const SKEW_MARGIN_MS = 5 * 60_000

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
        perPage: number,
        createdSince?: Date
    ) => Promise<{ ok: true; runs: WorkflowRun[] } | { ok: false; reason: GitHubFailure }>
}

export type SyncResult = {
    /** Why a workflow's history could not be read, when one could not. */
    failures: { slug: string; reason: GitHubFailure }[]
    /** How many runs were written, which is 0 on a tick where nothing has run. */
    stored: number
    /** How many pages were fetched, across all workflows. Seeding is the only time this is large. */
    fetched: number
    /** How many workflows were skipped because they had just been asked about. */
    throttled: number
    /**
     * When the token expires, as the sync state last recorded it.
     *
     * Carried here so the Operations page can warn about an expiring token on a
     * load that did not talk to GitHub. The live answer comes off a response
     * header, so a throttled sync has none — and a warning that comes and goes
     * with whether the last visit was ten seconds ago is a warning nobody trusts.
     */
    tokenExpiresAt?: string
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

/** What the sync remembers between runs: when each workflow was last asked about. */
type SyncState = {
    syncedAt: Record<string, string>
    tokenExpiresAt?: string
}

/**
 * An instant we are willing to send to GitHub, or nothing.
 *
 * Every value from storage goes through this, and it is not defensive
 * programming for its own sake. GitHub answers an unparseable `created` filter
 * with **zero runs and a 200** — verified against the API — so a bad timestamp
 * does not fail, it quietly reports that nothing has ever run again. The most
 * likely source of one is this project's own stack: `@google-cloud/firestore`
 * turns a `Date` into a `Timestamp`, and a `Timestamp` interpolated into a URL
 * is garbage that reads exactly like a repository where nothing happens.
 *
 * So the value is parsed and re-rendered rather than trusted, and anything that
 * does not survive the round trip becomes `undefined` — which sends the caller
 * down the unfiltered walk instead. Slow and correct beats fast and silent.
 */
export function instantFrom(value: unknown): Date | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

async function readState(db: Firestore): Promise<SyncState> {
    try {
        const document = await db.collection(SYNC_STATE).doc(SYNC_STATE_DOC).get()
        const data = (document.data() ?? {}) as Partial<SyncState>
        return { syncedAt: data.syncedAt ?? {}, tokenExpiresAt: data.tokenExpiresAt }
    } catch (error) {
        // Without it every workflow takes the unfiltered path: slower, and right.
        console.error('Could not read the workflow sync state', error)
        return { syncedAt: {} }
    }
}

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
        ((workflow: DispatchableWorkflow, page: number, perPage: number, createdSince?: Date) =>
            github().recentRuns(workflow, perPage, page, createdSince))

    /*
     * Two reads, both small, both needed before any workflow can be asked
     * anything: when each was last asked, and which runs are still in flight.
     */
    const [state, unfinished] = await Promise.all([
        readState(db),
        pending(db).catch((error) => {
            // Not fatal: without it a run that was in flight when last seen keeps
            // its old status until something else rewrites it, which is a stale
            // pill rather than a broken page.
            console.error('Could not read the in-flight workflow runs', error)
            return new Map<string, StoredWorkflowRun[]>()
        }),
    ])

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
                    now,
                    inFlight: unfinished.get(workflow.slug) ?? [],
                    syncedAt: instantFrom(state.syncedAt[workflow.slug]),
                })
            } catch (error) {
                console.error('Could not mirror a workflow history', { workflow: workflow.slug }, error)
                return { stored: 0, fetched: 0, failure: 'unknown' as const }
            }
        })
    )

    const failures = outcomes.flatMap((outcome, index) =>
        outcome.failure ? [{ slug: workflows[index]!.slug, reason: outcome.failure }] : []
    )
    const stored = outcomes.reduce((total, outcome) => total + outcome.stored, 0)
    const fetched = outcomes.reduce((total, outcome) => total + outcome.fetched, 0)
    const throttled = outcomes.filter((outcome) => outcome.throttled).length

    /*
     * Remember the moment for the workflows that actually got an answer, and
     * only those. A workflow whose sync failed keeps its old mark, so the next
     * attempt asks from where the last *successful* one stopped rather than
     * skipping the window it never managed to read.
     *
     * `asked` is stamped before the request rather than after, for the same
     * reason `SKEW_MARGIN_MS` exists: a run created while the request was in
     * flight belongs to the next window, not to neither.
     */
    const marks = Object.fromEntries(
        outcomes.flatMap((outcome, index) =>
            outcome.asked ? [[workflows[index]!.slug, outcome.asked.toISOString()]] : []
        )
    )
    const expiry = github().tokenExpiry(now)?.at.toISOString() ?? state.tokenExpiresAt

    if (Object.keys(marks).length > 0 || expiry !== state.tokenExpiresAt) {
        try {
            await db
                .collection(SYNC_STATE)
                .doc(SYNC_STATE_DOC)
                .set({ syncedAt: marks, ...(expiry ? { tokenExpiresAt: expiry } : {}) }, { merge: true })
        } catch (error) {
            // A mark that did not get written costs the next sync a wider window,
            // which is slower and still correct.
            console.error('Could not record the workflow sync state', error)
        }
    }

    try {
        await trimByAge(db, RUNS, now)
    } catch (error) {
        // Best effort, like the job log's: a mirror that is up to date and then
        // fails to tidy up is a mirror that worked.
        console.error('Could not trim the workflow run mirror', error)
    }

    return { failures, stored, fetched, throttled, tokenExpiresAt: expiry }
}

async function one(
    db: Firestore,
    workflow: DispatchableWorkflow,
    options: {
        maxPages: number
        read: NonNullable<SyncOptions['runs']>
        now: Date
        /** The runs of this workflow whose outcome we do not yet know. */
        inFlight: StoredWorkflowRun[]
        /** When this workflow was last successfully asked about. */
        syncedAt: Date | undefined
    }
): Promise<{ stored: number; fetched: number; failure?: GitHubFailure; throttled?: true; asked?: Date }> {
    /*
     * Just asked. The Operations page syncs on every load, so a reload, a back
     * button and an impatient double-click are three requests for an answer that
     * cannot have changed — see `MIN_SYNC_INTERVAL_MS`.
     */
    if (options.syncedAt && options.now.getTime() - options.syncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
        return { stored: 0, fetched: 0, throttled: true }
    }

    const asked = options.now

    /*
     * The window: everything since the last time we asked, widened to reach any
     * run whose outcome is still unknown.
     *
     * Those two are one question rather than two. `created` filters on when a run
     * *started existing*, so a run that was queued an hour ago and has finished
     * since is older than the last sync and would be left out — and being left
     * out permanently is how a row stays at `queued` for good. Reaching back to
     * the oldest one in flight covers it, and covers anything created after it,
     * for the same single request.
     */
    const inFlightSince = options.inFlight
        .map((run) => instantFrom(run.startedAt))
        .filter((at): at is Date => at !== undefined)
        .sort((a, b) => a.getTime() - b.getTime())[0]

    /*
     * The margin is applied to whichever of the two is earlier, and applying it
     * to the in-flight run as well is not belt and braces. `created:>T` is
     * exclusive, so a window starting exactly at that run's timestamp leaves out
     * the one run it was widened to collect — and `startedAt` is
     * `run_started_at`, which is at or after the `created_at` the filter
     * compares against, so starting level with it would miss the run twice over.
     */
    const since =
        options.syncedAt &&
        new Date(
            Math.min(options.syncedAt.getTime(), inFlightSince?.getTime() ?? Number.POSITIVE_INFINITY) -
                SKEW_MARGIN_MS
        )

    const writes: StoredWorkflowRun[] = []

    if (since) {
        /*
         * The cheap path, and the one nearly every sync takes: GitHub does the
         * filtering, and the usual answer is an empty list in 36 bytes. Compare
         * 1.5 MB for a page of a hundred runs we mostly already hold.
         *
         * Everything that comes back is written, without consulting the archive
         * first. Inside a window this narrow there is nothing to save by asking —
         * the runs are new, or they are the handful in flight we came for, and a
         * rewrite of either is one idempotent `set`.
         */
        for (let page = 1; page <= options.maxPages; page += 1) {
            const outcome = await options.read(workflow, page, PER_PAGE, since)
            if (!outcome.ok) return { stored: await store(db, writes), fetched: page, failure: outcome.reason }

            writes.push(...outcome.runs.map((run) => asStored(run, workflow.slug)))
            if (outcome.runs.length < PER_PAGE) {
                return { stored: await store(db, writes), fetched: page, asked }
            }
        }
        return { stored: await store(db, writes), fetched: options.maxPages, asked }
    }

    /*
     * No usable mark, so no window: a workflow being met for the first time, a
     * sync state that was lost, or a stored timestamp that did not survive
     * `instantFrom`. Walk the history instead, stopping at the first run we
     * already hold — which on a seeded archive is the first page, and on an empty
     * one is the whole of what GitHub still has.
     */
    const newest = await newestRunNumber(db, workflow.slug)
    const stillPending = new Set(options.inFlight.map((run) => run.runNumber))
    let fetched = 0

    for (let page = 1; page <= options.maxPages; page += 1) {
        const outcome = await options.read(workflow, page, PER_PAGE)
        fetched += 1
        if (!outcome.ok) {
            // What has already been collected is still written: a rate limit on
            // page three should not throw away pages one and two.
            return { stored: await store(db, writes), fetched, failure: outcome.reason }
        }

        writes.push(
            ...outcome.runs
                .filter((run) => run.runNumber > newest || stillPending.has(run.runNumber))
                .map((run) => asStored(run, workflow.slug))
        )

        // The stop the walk exists for: the page reached back into what we
        // already hold, so everything below it is held too.
        if (outcome.runs.some((run) => run.runNumber <= newest)) break
        // GitHub had nothing more to give. Only reachable while seeding, and it
        // is what makes the first sync end at the bottom of the history rather
        // than at the page budget.
        if (outcome.runs.length < PER_PAGE) break
    }

    return { stored: await store(db, writes), fetched, asked }
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

/**
 * The runs that were still going when they were last seen, by workflow.
 *
 * The runs themselves rather than their numbers, because the window needs their
 * start times: how far back a sync has to reach is decided by the oldest one
 * still in flight.
 */
async function pending(db: Firestore): Promise<Map<string, StoredWorkflowRun[]>> {
    const snapshot = await db.collection(RUNS).where('pending', '==', true).get()
    const byWorkflow = new Map<string, StoredWorkflowRun[]>()
    for (const document of snapshot.docs) {
        const run = document.data() as StoredWorkflowRun
        byWorkflow.set(run.slug, [...(byWorkflow.get(run.slug) ?? []), run])
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
