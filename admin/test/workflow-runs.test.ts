import { describe, expect, it } from 'vitest'

import type { WorkflowRun } from '../src/lib/github.ts'
import type { DispatchableWorkflow } from '../src/lib/workflows.ts'
import { PER_PAGE, PROBE_PAGE, sync, type StoredWorkflowRun } from '../src/lib/workflow-runs.ts'

/**
 * Mirroring GitHub's run history into Firestore.
 *
 * The whole design rests on one claim — that a sync normally costs a single page
 * of a single request per workflow — and that claim is a *stop condition*, which
 * is the kind of thing that is easy to write, easy to believe, and silently
 * wrong in one of two directions. Stop too early and the archive grows holes
 * nobody notices until somebody looks for July. Stop too late and every page
 * load walks a repository's entire history.
 *
 * So the stand-in below counts pages, and most of these tests are assertions
 * about that count rather than about what was written.
 */

const workflow: DispatchableWorkflow = {
    slug: 'handicaps',
    file: 'update-handicaps.yml',
    label: "Players' official handicaps",
    blurb: 'Reads handicaps.',
    cadence: 'tick',
}

const run = (runNumber: number, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
    status: 'completed',
    conclusion: 'success',
    // Descending with the run number, as GitHub returns them.
    startedAt: new Date(Date.UTC(2026, 8, 18) - (2000 - runNumber) * 3_600_000).toISOString(),
    event: 'schedule',
    runNumber,
    url: `https://github.com/hectorgolf/hector.golf/actions/runs/${runNumber}`,
    ...over,
})

/**
 * A Firestore holding `stored`, and remembering what was written to it.
 *
 * The queries this has to answer are the two the sync makes: "the newest run of
 * this workflow" and "every run still in flight". Both are answered off the same
 * array, so a test sets up state by listing documents rather than by scripting
 * calls.
 */
function fakeFirestore(stored: StoredWorkflowRun[] = []) {
    const written = new Map<string, StoredWorkflowRun>()
    const deleted: string[] = []

    const snapshotOf = (docs: StoredWorkflowRun[]) => ({
        empty: docs.length === 0,
        docs: docs.map((data) => ({ data: () => data, ref: `${data.slug}_${data.runNumber}` })),
    })

    const db = {
        collection: () => ({
            doc: (id: string) => id,
            where: (field: string, _op: string, value: unknown) => {
                if (field === 'pending') {
                    return { get: async () => snapshotOf(stored.filter((candidate) => candidate.pending)) }
                }
                if (field === 'slug') {
                    const mine = [...stored]
                        .filter((candidate) => candidate.slug === value)
                        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                    return {
                        orderBy: () => ({ limit: (limit: number) => ({ get: async () => snapshotOf(mine.slice(0, limit)) }) }),
                    }
                }
                // The retention trim, which these tests give nothing to do.
                return { limit: () => ({ get: async () => snapshotOf([]) }) }
            },
        }),
        batch: () => ({
            set: (id: string, data: StoredWorkflowRun) => written.set(id, data),
            commit: async () => {},
            delete: (ref: string) => deleted.push(ref),
        }),
    }

    return { db: db as any, written, deleted }
}

/**
 * GitHub's list, served a page at a time, recording what was asked for.
 *
 * It honours `perPage`, and that is not a detail: a stand-in that answered every
 * request with a hundred runs would let the probe look like it worked while the
 * deployed service downloaded 1.5 MB per workflow per page load, which is exactly
 * the bug these tests were written after.
 */
function fakeGitHub(runs: WorkflowRun[]) {
    const asked: { page: number; perPage: number }[] = []
    return {
        asked,
        get pages() {
            return asked.map((call) => call.page)
        },
        get sizes() {
            return asked.map((call) => call.perPage)
        },
        read: async (_workflow: DispatchableWorkflow, page: number, perPage: number) => {
            asked.push({ page, perPage })
            const from = (page - 1) * perPage
            return { ok: true as const, runs: runs.slice(from, from + perPage) }
        },
    }
}

const stored = (runNumber: number, over: Partial<StoredWorkflowRun> = {}): StoredWorkflowRun => ({
    ...run(runNumber),
    slug: 'handicaps',
    ...over,
})

describe('syncing what GitHub has run', () => {
    it('asks for a small page when it is only checking whether anything is new', async () => {
        // The normal case, and the one that decides what the Operations page
        // costs. A page of a hundred runs is 1.5 MB of JSON; the mirror already
        // holds everything below the high-water mark, so the probe only has to
        // reach back far enough to find it.
        const history = Array.from({ length: 450 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore([stored(1497)])

        const result = await sync([workflow], { db, runs: github.read, maxPages: 10 })

        expect(github.asked).toEqual([{ page: 1, perPage: PROBE_PAGE }])
        expect(result.fetched).toBe(1)
        // Only the three above the high-water mark, not the ten on the page.
        expect([...written.keys()].sort()).toEqual([
            'handicaps_1498',
            'handicaps_1499',
            'handicaps_1500',
        ])
        expect(result.stored).toBe(3)
    })

    it('walks the full pages when more has happened than the probe can see', async () => {
        // A service that was asleep for days, or a workflow somebody ran in a
        // loop. The probe cannot reach what we hold, so it falls through — and
        // re-reads its ten as part of the first full page rather than carrying
        // them over, so nothing is written twice.
        const history = Array.from({ length: 450 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore([stored(1300)])

        const result = await sync([workflow], { db, runs: github.read, maxPages: 10 })

        expect(github.asked).toEqual([
            { page: 1, perPage: PROBE_PAGE },
            { page: 1, perPage: PER_PAGE },
            { page: 2, perPage: PER_PAGE },
            // Page 2 ends at run 1301, one above the mark, so it takes a third
            // page to actually reach what we hold.
            { page: 3, perPage: PER_PAGE },
        ])
        // 1301..1500, once each: the probe's ten are among them, written once.
        expect(written.size).toBe(200)
        expect(result.stored).toBe(200)
    })

    it('pages back through the history the first time it meets a workflow', async () => {
        // Nothing stored, so nothing to stop at: the sync walks until GitHub runs
        // out. This is what makes the archive start complete rather than filling
        // in from today.
        const history = Array.from({ length: 250 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore()

        const result = await sync([workflow], { db, runs: github.read, maxPages: 10 })

        // No probe: a workflow with nothing stored has no high-water mark to find
        // and is going to read the whole history anyway, so it wants the big
        // pages from the start.
        expect(github.asked).toEqual([
            { page: 1, perPage: PER_PAGE },
            { page: 2, perPage: PER_PAGE },
            { page: 3, perPage: PER_PAGE },
        ])
        expect(written.size).toBe(250)
        expect(result.stored).toBe(250)
    })

    it('does not walk further than its budget, however much history there is', async () => {
        // The guard on the seeding walk. A page render passes a small budget for
        // exactly this reason: an unbounded walk is a request that never returns.
        const history = Array.from({ length: 5000 }, (_, index) => run(5000 - index))
        const github = fakeGitHub(history)
        const { db } = fakeFirestore()

        await sync([workflow], { db, runs: github.read, maxPages: 3 })

        expect(github.pages).toEqual([1, 2, 3])
    })

    it('rewrites a run that was still going when it was last seen', async () => {
        // Without this the sync would never look at it again — its number is not
        // above the high-water mark — and the log would show `queued` for a run
        // that finished hours ago.
        const github = fakeGitHub([run(1500), run(1499)])
        const { db, written } = fakeFirestore([
            stored(1500, { status: 'in_progress', conclusion: null, pending: true }),
            stored(1499),
        ])

        await sync([workflow], { db, runs: github.read })

        const refreshed = written.get('handicaps_1500')
        expect(refreshed).toMatchObject({ status: 'completed', conclusion: 'success' })
        // The flag has to be *gone* rather than false, or every later sync pays
        // to read this document and discard it.
        expect(refreshed && 'pending' in refreshed).toBe(false)
        // The one below it was neither new nor in flight, so it was left alone.
        expect(written.has('handicaps_1499')).toBe(false)
    })

    it('goes back for a run still in flight from below the probe, rather than stranding it', async () => {
        // Below the high-water mark, so nothing makes it new; below the probe, so
        // nothing fetches it. Stopping at the probe would leave the row reading
        // `queued` for good and the pending query carrying it forever.
        const history = Array.from({ length: 450 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore([
            stored(1500),
            stored(1450, { status: 'in_progress', conclusion: null, pending: true }),
        ])

        await sync([workflow], { db, runs: github.read, maxPages: 10 })

        expect(github.sizes).toEqual([PROBE_PAGE, PER_PAGE])
        const repaired = written.get('handicaps_1450')
        expect(repaired).toMatchObject({ status: 'completed', conclusion: 'success' })
        expect(repaired && 'pending' in repaired).toBe(false)
    })

    it('marks a run that has not finished, so the next sync comes back for it', async () => {
        const github = fakeGitHub([run(1501, { status: 'in_progress', conclusion: null })])
        const { db, written } = fakeFirestore([stored(1500)])

        await sync([workflow], { db, runs: github.read })

        expect(written.get('handicaps_1501')).toMatchObject({ pending: true })
    })

    it('keeps the pages it did read when a later one is refused', async () => {
        // A rate limit on page three should not throw away pages one and two:
        // the archive is append-mostly, and a partial sync is repaired by the
        // next one rather than by re-fetching what already arrived.
        const history = Array.from({ length: 250 }, (_, index) => run(1500 - index))
        const { db, written } = fakeFirestore()
        let page = 0

        const result = await sync([workflow], {
            db,
            maxPages: 10,
            runs: async () => {
                page += 1
                if (page > 2) return { ok: false as const, reason: 'rate-limited' as const }
                const from = (page - 1) * PER_PAGE
                return { ok: true as const, runs: history.slice(from, from + PER_PAGE) }
            },
        })

        expect(result.failures).toEqual([{ slug: 'handicaps', reason: 'rate-limited' }])
        expect(written.size).toBe(200)
    })

    it('asks the workflows at once rather than one after another', async () => {
        /*
         * A barrier rather than a stopwatch: every read blocks until all three
         * have arrived, so a sync that awaits one workflow before starting the
         * next can never get past the first and the test times out instead of
         * passing slowly.
         *
         * Worth a test of its own because the serial version looked completely
         * correct — same results, same writes, five round trips one after another
         * instead of at once — and cost the Operations page several seconds a
         * load. Nothing about its output said so.
         */
        const workflows = ['handicaps', 'leaderboards', 'deploy'].map((slug) => ({ ...workflow, slug }))
        const { db } = fakeFirestore()

        let arrived = 0
        let release: () => void
        const everybody = new Promise<void>((resolve) => (release = resolve))

        const result = await sync(workflows, {
            db,
            runs: async () => {
                arrived += 1
                if (arrived === workflows.length) release!()
                await everybody
                return { ok: true as const, runs: [run(1500)] }
            },
        })

        expect(arrived).toBe(workflows.length)
        expect(result.failures).toEqual([])
    }, 2_000)

    it('reports a failure per workflow rather than giving up on the rest', async () => {
        const deploy: DispatchableWorkflow = { ...workflow, slug: 'deploy', file: 'deploy-site.yml' }
        const { db, written } = fakeFirestore()

        const result = await sync([workflow, deploy], {
            db,
            runs: async (which) =>
                which.slug === 'deploy'
                    ? { ok: false as const, reason: 'unauthorized' as const }
                    : { ok: true as const, runs: [run(1500)] },
        })

        expect(result.failures).toEqual([{ slug: 'deploy', reason: 'unauthorized' }])
        expect(written.has('handicaps_1500')).toBe(true)
    })

    it('never throws, because a page render and a tick both continue without it', async () => {
        const db = {
            collection: () => ({
                where: () => {
                    throw new Error('Firestore is having a bad day')
                },
            }),
        }

        const result = await sync([workflow], {
            db: db as any,
            runs: async () => ({ ok: true as const, runs: [run(1500)] }),
        })

        expect(result.failures).toEqual([{ slug: 'handicaps', reason: 'unknown' }])
        expect(result.stored).toBe(0)
    })
})
