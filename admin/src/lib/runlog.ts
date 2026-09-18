import type { JobRun } from './jobs/log.ts'
import type { StoredWorkflowRun } from './workflow-runs.ts'
import { changesInWords, requesterInWords, labelOfJob, toneOfJob } from './jobs/presentation.ts'
import { labelOf, toneOf, triggerInWords, type RunTone } from './runs.ts'

/**
 * One log across both halves of the Operations page: the workflows this service
 * asks GitHub to run, and the jobs it runs itself.
 *
 * ## Why they are merged rather than shown as two tables
 *
 * The page already made this argument about the workflows among themselves —
 * "what a reader is looking for here is a *time of day* repeating down the
 * column, and two tables side by side is where that stops being obvious". The
 * jobs run on the *same tick* as the workflows, so the argument extends to them
 * with more force, not less: a tick is one event that produces rows in both
 * lists, and two tables is where you stop being able to see that the 05:00 job
 * ran thirty seconds before the 05:00 workflow.
 *
 * ## Why the two run shapes are not unified further up
 *
 * A workflow run is GitHub's record — a conclusion, a run number and a page to
 * link to — and `JobRun` is ours — an outcome, a change list and no page at all.
 * `jobs/presentation.ts` explains why forcing one shape over both would mean
 * inventing halves of each. That stays true; what this module adds is a shape
 * for the *table*, built from whichever of the two a row came from, so the merge
 * happens at the point of rendering rather than in either source.
 */

export type RunKind = 'workflow' | 'job'

/** One row of the log, whichever half it came from. */
export type LogEntry = {
    kind: RunKind
    slug: string
    /**
     * What the type filter matches on, and why it is not just the slug: a slug
     * is only unique within its own list. `handicaps` names both
     * `update-handicaps.yml` and the in-process job that replaced it, which is
     * the same collision the page's `ran`/`ranJob` parameters exist for.
     */
    type: string
    label: string
    startedAt: string
    /** Who or what started it, in the words each half uses. */
    by: string
    tone: RunTone
    /** What the pill says. */
    outcome: string
    /** What the run found. Jobs know; a workflow run does not say. */
    detail?: string
    /** GitHub's page for the run, for the half that has one. */
    url?: string
    runNumber?: number
}

export const typeOf = (kind: RunKind, slug: string): string => `${kind}:${slug}`

/**
 * Which pill a tone wears, defined once for everything that renders a run.
 *
 * The cards on the Operations page and the log's own table have to agree — a
 * card saying green and the row beneath it saying grey about the same run is a
 * page arguing with itself — and they used to agree by having the same literal
 * written out in each. `running` is only ever reached from a GitHub run: a job
 * runs inside the request and is over before anything reads it.
 */
export const TONE_PILL: Record<RunTone, string> = {
    running: 'pill-live',
    good: 'pill-victor',
    bad: 'pill-matchplay',
    neutral: 'pill-outline',
}

export function fromWorkflowRun(run: StoredWorkflowRun, label: string): LogEntry {
    return {
        kind: 'workflow',
        slug: run.slug,
        type: typeOf('workflow', run.slug),
        label,
        startedAt: run.startedAt,
        by: triggerInWords(run),
        tone: toneOf(run),
        outcome: labelOf(run),
        url: run.url,
        runNumber: run.runNumber,
    }
}

export function fromJobRun(run: JobRun, label: string): LogEntry {
    return {
        kind: 'job',
        slug: run.slug,
        type: typeOf('job', run.slug),
        label,
        startedAt: run.startedAt,
        by: requesterInWords(run),
        tone: toneOfJob(run),
        outcome: labelOfJob(run),
        detail: run.detail ?? changesInWords(run.changes),
    }
}

/** Newest first, which is the only order this log is ever read in. */
export function byNewest(entries: readonly LogEntry[]): LogEntry[] {
    return [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * The tones a reader can filter by, in the words the filter offers them.
 *
 * Tone rather than the raw outcome word, because the two halves do not share a
 * vocabulary: GitHub says `success`, `failure`, `cancelled`, `timed_out`, and a
 * job says `success`, `shadow`, `skipped`, `failed`. A filter listing all of
 * those would be a filter nobody reads to the end of, and it would quietly grow
 * an option every time GitHub adds a conclusion. The tone is also what the pill
 * colour already says, so filtering by it is filtering by what is on the screen.
 */
export const STATUSES: readonly { value: RunTone; label: string }[] = [
    { value: 'good', label: 'Succeeded' },
    { value: 'bad', label: 'Failed' },
    { value: 'running', label: 'Still running' },
    { value: 'neutral', label: 'Cancelled or skipped' },
]

export const isStatus = (value: string | null | undefined): value is RunTone =>
    STATUSES.some((status) => status.value === value)

export type Filter = { type?: string; status?: RunTone }

/**
 * Both filters read from the URL, so both are whatever was in the address bar.
 * Neither is rendered and neither reaches a query: `type` is compared against
 * keys built from our own two lists, and `status` against the four tones above,
 * so anything a stranger can put in a link narrows the list to nothing at worst.
 */
export function matching(entries: readonly LogEntry[], filter: Filter): LogEntry[] {
    return entries.filter(
        (entry) =>
            (filter.type === undefined || entry.type === filter.type) &&
            (filter.status === undefined || entry.tone === filter.status)
    )
}

/** How many rows a page of the full log holds. */
export const PAGE_SIZE = 100

/**
 * How many rows the Operations page itself holds.
 *
 * Enough to cover a couple of days of ticks, which is the window in which "did
 * last night run" is a question. Past that the page is answering a different
 * question — "what happened last week" — and that one has its own page, where
 * the list can be narrowed rather than merely scrolled.
 */
export const RECENT = 50

/**
 * How deep a reader may page.
 *
 * `page` comes from the URL and decides how many rows are read, so it needs a
 * ceiling that is not "whatever was typed": without one, `?page=100000` is a
 * request for ten million documents. Fifty pages is five thousand runs, which is
 * past the retention horizon in every direction — a reader who reaches the end
 * of the log reaches it before this.
 */
export const MAX_PAGE = 50

/**
 * How many rows to read for a given page, from each half of the log.
 *
 * The merge is what forces the shape: a row on page three could have come
 * entirely from either half, so each has to offer everything down to the bottom
 * of that page. The one extra row is what says whether there is another page —
 * cheaper than counting, and exact.
 */
export const windowFor = (page: number, size: number = PAGE_SIZE): number => clampPage(page) * size + 1

const clampPage = (page: number): number =>
    Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE) : 1

export type Paged = {
    entries: LogEntry[]
    /** 1-based, and clamped: a `?page=` past the end shows the last page with rows on it. */
    page: number
    /** 1-based positions of the first and last row shown, or 0 when empty. */
    first: number
    last: number
    /** Whether there is a page after this one. */
    older: boolean
    /**
     * How many rows there are in total — known only once the end of the log is
     * inside the window that was read, which is to say on the last page.
     *
     * Absent rather than estimated on the pages before it. The alternative is a
     * count query per view, and a count that can only be had by reading every
     * row it counts the moment the filter is one Firestore cannot answer — the
     * outcome filter is derived from status and conclusion rather than stored, so
     * it is exactly that kind of filter.
     */
    total?: number
}

/**
 * Slice one page out of the window that was read for it.
 *
 * `entries` is expected to be at most `windowFor(page)` long — everything down
 * to the bottom of this page, plus the one row that says whether there is
 * another.
 */
export function pageOf(entries: readonly LogEntry[], page: number, size: number = PAGE_SIZE): Paged {
    // Clamped twice over, and the second one is the useful one: the first keeps
    // the read bounded, and this keeps a `?page=9` against a two-page log from
    // rendering an empty table that reads as "no runs" rather than as a mistyped
    // address.
    const wanted = clampPage(page)
    const available = Math.max(1, Math.ceil(entries.length / size))
    const current = Math.min(wanted, available)

    const from = (current - 1) * size
    const shown = entries.slice(from, from + size)
    const older = entries.length > from + size

    return {
        entries: [...shown],
        page: current,
        first: shown.length === 0 ? 0 : from + 1,
        last: from + shown.length,
        older,
        total: older ? undefined : entries.length,
    }
}

/** A workflow or a job, in the two fields this module needs from either. */
export type Named = { slug: string; label: string }

/**
 * Read both halves and merge them.
 *
 * Two reads of the same database now that GitHub's runs are mirrored — see
 * `lib/workflow-runs.ts` — where this used to be one database read and five HTTP
 * calls. They are injected rather than imported so this can be tested without a
 * Firestore, and so a caller can pass a reader narrowed to one workflow or one
 * job instead of a share of everything.
 *
 * In parallel, because they are independent and this is the page's only latency
 * once the sync above it has finished.
 */
export async function collect(source: {
    workflows: readonly Named[]
    jobs: readonly Named[]
    workflowRuns: () => Promise<StoredWorkflowRun[]>
    jobRuns: () => Promise<JobRun[]>
}): Promise<LogEntry[]> {
    const [workflowRuns, jobRuns] = await Promise.all([source.workflowRuns(), source.jobRuns()])

    /*
     * A run is kept even when nothing in the registries claims its slug, under
     * the slug as its own label. The log outlives both lists — entries stay for
     * their retention however the lists change, and a workflow retired by the
     * migration is precisely the kind of thing somebody comes here to read about
     * afterwards — so dropping those rows would delete the only record of what it
     * did, silently, at the moment it is most likely to be wanted.
     */
    const workflowLabels = new Map(source.workflows.map((workflow) => [workflow.slug, workflow.label]))
    const jobLabels = new Map(source.jobs.map((job) => [job.slug, job.label]))

    return byNewest([
        ...workflowRuns.map((run) => fromWorkflowRun(run, workflowLabels.get(run.slug) ?? run.slug)),
        ...jobRuns.map((run) => fromJobRun(run, jobLabels.get(run.slug) ?? run.slug)),
    ])
}
