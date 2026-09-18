import { describe, expect, it } from 'vitest'

import type { JobRun } from '../src/lib/jobs/log.ts'
import {
    collect,
    fromJobRun,
    fromWorkflowRun,
    isStatus,
    matching,
    MAX_PAGE,
    pageOf,
    typeOf,
    windowFor,
} from '../src/lib/runlog.ts'
import type { StoredWorkflowRun } from '../src/lib/workflow-runs.ts'

/**
 * The one log the Operations page and its full-log page both read.
 *
 * Two things are worth testing here and neither is the rendering. The first is
 * the merge: two stored shapes, one sort, and a slug that means different things
 * depending on which half it came from. The second is the paging arithmetic,
 * which is fed straight from the query string and decides how many documents get
 * read — so "page 0", "page 900" and "page banana" are inputs rather than
 * hypotheticals.
 */

const workflowRun = (over: Partial<StoredWorkflowRun> = {}): StoredWorkflowRun => ({
    slug: 'handicaps',
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-09-18T05:00:12Z',
    event: 'workflow_dispatch',
    runNumber: 1505,
    url: 'https://github.com/hectorgolf/hector.golf/actions/runs/34745996205',
    ...over,
})

const jobRun = (over: Partial<JobRun> = {}): JobRun => ({
    slug: 'handicaps',
    startedAt: '2026-09-18T05:00:35Z',
    finishedAt: '2026-09-18T05:01:06Z',
    by: 'the schedule',
    dryRun: false,
    outcome: 'ok',
    changes: [],
    ...over,
})

const HANDICAPS = "Players' official handicaps"

describe('turning either kind of run into a row', () => {
    it('tells the two halves apart by something other than the slug', () => {
        // The collision that `ran`/`ranJob` already exists for: `handicaps` names
        // both `update-handicaps.yml` and the job that replaced it, and on this
        // page they wear the same label too. If the filter matched on the slug,
        // choosing one would show both.
        const fromWorkflow = fromWorkflowRun(workflowRun(), HANDICAPS)
        const fromJob = fromJobRun(jobRun(), HANDICAPS)

        expect(fromWorkflow.slug).toBe(fromJob.slug)
        expect(fromWorkflow.label).toBe(fromJob.label)
        expect(fromWorkflow.type).not.toBe(fromJob.type)
        expect(fromWorkflow.type).toBe(typeOf('workflow', 'handicaps'))
    })

    it('keeps what only one half has: the run link, and what the run found', () => {
        const fromWorkflow = fromWorkflowRun(workflowRun(), HANDICAPS)
        expect(fromWorkflow.runNumber).toBe(1505)
        expect(fromWorkflow.detail).toBeUndefined()

        const changed = fromJobRun(jobRun({ changes: [{ subject: 'sami-h', from: '4.8', to: '5.2' }] }), HANDICAPS)
        expect(changed.url).toBeUndefined()
        expect(changed.detail).toBe('sami-h 4.8 → 5.2')
    })

    it('carries the tone each half decides for itself, so one pill scale covers both', () => {
        expect(fromWorkflowRun(workflowRun({ status: 'in_progress', conclusion: null }), HANDICAPS).tone).toBe(
            'running'
        )
        expect(fromWorkflowRun(workflowRun({ conclusion: 'cancelled' }), HANDICAPS).tone).toBe('neutral')
        expect(fromJobRun(jobRun({ outcome: 'failed' }), HANDICAPS).tone).toBe('bad')
        // A shadow run succeeded at deciding, not at writing, and says so.
        expect(fromJobRun(jobRun({ dryRun: true }), HANDICAPS).outcome).toBe('shadow')
    })
})

describe('narrowing the log', () => {
    const entries = [
        fromWorkflowRun(workflowRun({ startedAt: '2026-09-18T05:00:12Z' }), HANDICAPS),
        fromWorkflowRun(
            workflowRun({ slug: 'leaderboards', startedAt: '2026-09-18T05:00:14Z', conclusion: 'failure' }),
            'Tournament leaderboards'
        ),
        fromJobRun(jobRun({ startedAt: '2026-09-18T05:00:35Z' }), HANDICAPS),
    ]

    it('picks one half of a shared slug rather than both', () => {
        const only = matching(entries, { type: typeOf('job', 'handicaps') })
        expect(only).toHaveLength(1)
        expect(only[0]!.kind).toBe('job')
    })

    it('filters by the tone the pill shows, across both halves at once', () => {
        expect(matching(entries, { status: 'bad' }).map((entry) => entry.slug)).toEqual(['leaderboards'])
        expect(matching(entries, { status: 'good' })).toHaveLength(2)
    })

    it('combines the two filters', () => {
        expect(matching(entries, { type: typeOf('workflow', 'handicaps'), status: 'bad' })).toEqual([])
    })

    it('only accepts a status it can act on, because this one comes from the URL', () => {
        expect(isStatus('good')).toBe(true)
        expect(isStatus('success')).toBe(false)
        expect(isStatus(null)).toBe(false)
    })
})

describe('deciding how much to read', () => {
    it('asks for everything down to the bottom of the page, plus the row that says there is another', () => {
        expect(windowFor(1)).toBe(101)
        expect(windowFor(3)).toBe(301)
    })

    it('will not let the address bar ask for ten million documents', () => {
        // The reason this is clamped here rather than only where the page is
        // sliced: `windowFor` is what becomes a Firestore `limit`, so an
        // unclamped `?page=100000` is a read, not a rendering mistake.
        expect(windowFor(100_000)).toBe(MAX_PAGE * 100 + 1)
        expect(windowFor(0)).toBe(101)
        expect(windowFor(-3)).toBe(101)
        expect(windowFor(Number.NaN)).toBe(101)
    })
})

describe('paging', () => {
    /** A window as the page reads it: `windowFor(page)` rows at most. */
    const window = (rows: number) =>
        Array.from({ length: rows }, (_, index) =>
            fromWorkflowRun(
                workflowRun({
                    startedAt: new Date(Date.UTC(2026, 8, 18) - index * 3_600_000).toISOString(),
                    runNumber: 1000 - index,
                }),
                HANDICAPS
            )
        )

    it('counts from one, and says which rows are on the screen', () => {
        const first = pageOf(window(101), 1)
        expect(first.entries).toHaveLength(100)
        expect([first.first, first.last, first.older]).toEqual([1, 100, true])
    })

    it('shows the page that was asked for, not the top of the window read for it', () => {
        const second = pageOf(window(201), 2)
        expect(second.entries).toHaveLength(100)
        expect([second.first, second.last]).toEqual([101, 200])
        expect(second.entries[0]!.runNumber).toBe(900)
    })

    it('knows the total only once the end of the log is in the window', () => {
        // The honest half of windowed paging: on a middle page nothing has been
        // read that could say how many rows there are, and a count query cannot
        // answer the outcome filter, so the page says the range and stops.
        expect(pageOf(window(250), 2).total).toBeUndefined()
        expect(pageOf(window(170), 2)).toMatchObject({ first: 101, last: 170, older: false, total: 170 })
    })

    it('clamps what the address bar can put in it, rather than rendering an empty table', () => {
        // Each of these used to read as "no runs", which looks like a broken log
        // rather than like a mistyped address.
        const rows = window(250)
        expect(pageOf(rows, 0).page).toBe(1)
        expect(pageOf(rows, -4).page).toBe(1)
        expect(pageOf(rows, 900).page).toBe(3)
        expect(pageOf(rows, Number.NaN).page).toBe(1)
        expect(pageOf(rows, 2.7).page).toBe(2)
    })

    it('has no rows and no next page when there is nothing, so the controls still make sense', () => {
        expect(pageOf([], 1)).toMatchObject({ page: 1, first: 0, last: 0, older: false, total: 0 })
    })
})

describe('collecting both halves', () => {
    const source = (over: Partial<Parameters<typeof collect>[0]> = {}) => ({
        workflows: [{ slug: 'handicaps', label: HANDICAPS }],
        jobs: [{ slug: 'handicaps', label: HANDICAPS }],
        workflowRuns: async () => [workflowRun({ startedAt: '2026-09-18T05:00:12Z' })],
        jobRuns: async () => [jobRun({ startedAt: '2026-09-18T05:00:35Z' })],
        ...over,
    })

    it('interleaves the two halves by time, which is the whole reason they are one table', async () => {
        // The pair the plan document records: the job reached its answer
        // thirty-one seconds before the workflow committed the same change. In
        // two tables that is two rows nobody puts side by side.
        const entries = await collect(source())

        expect(entries.map((entry) => [entry.kind, entry.startedAt])).toEqual([
            ['job', '2026-09-18T05:00:35Z'],
            ['workflow', '2026-09-18T05:00:12Z'],
        ])
    })

    it('keeps the history of something the registries no longer list', async () => {
        // The log outlives both lists — a workflow retired by the migration is
        // exactly what somebody comes here to read about afterwards — so these
        // rows are labelled by their slug rather than dropped.
        const entries = await collect(
            source({
                workflowRuns: async () => [workflowRun({ slug: 'club-memberships' })],
                jobRuns: async () => [jobRun({ slug: 'biographies' })],
            })
        )

        expect(entries.map((entry) => entry.label).sort()).toEqual(['biographies', 'club-memberships'])
    })
})
