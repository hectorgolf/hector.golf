import { describe, expect, it } from 'vitest'

import type { WorkflowRun } from '../src/lib/github.ts'
import type { DispatchableWorkflow } from '../src/lib/workflows.ts'
import {
    instantFrom,
    MIN_SYNC_INTERVAL_MS,
    PER_PAGE,
    SKEW_MARGIN_MS,
    sync,
    SYNC_STATE,
    type StoredWorkflowRun,
} from '../src/lib/workflow-runs.ts'

/**
 * Mirroring GitHub's run history into Firestore.
 *
 * Almost everything here asserts *what was asked of GitHub* rather than what
 * ended up in the database, and that is deliberate: the results were never the
 * thing that went wrong. The first version of this sync produced perfectly
 * correct rows while downloading 1.5 MB per workflow per page load, one workflow
 * after another, and nothing about its output said so.
 *
 * The rest is about the `created` filter's one nasty property, verified against
 * the real API: an unparseable value is answered with **zero runs and a 200**. A
 * bad timestamp does not fail, it quietly reports that nothing has ever run
 * again — so the tests that matter most are the ones about refusing to send one.
 */

const workflow: DispatchableWorkflow = {
    slug: 'handicaps',
    file: 'update-handicaps.yml',
    label: "Players' official handicaps",
    blurb: 'Reads handicaps.',
    cadence: 'tick',
}

const NOW = new Date('2026-09-19T12:00:00.000Z')

const run = (runNumber: number, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
    status: 'completed',
    conclusion: 'success',
    // Descending with the run number, as GitHub returns them, a minute apart —
    // close enough together that a realistic window covers the recent ones and
    // leaves the older ones out, which is what most of these tests turn on.
    startedAt: new Date(NOW.getTime() - (1502 - runNumber) * 60_000).toISOString(),
    event: 'schedule',
    runNumber,
    url: `https://github.com/hectorgolf/hector.golf/actions/runs/${runNumber}`,
    ...over,
})

const stored = (runNumber: number, over: Partial<StoredWorkflowRun> = {}): StoredWorkflowRun => ({
    ...run(runNumber),
    slug: 'handicaps',
    ...over,
})

/**
 * A Firestore holding some runs and a sync state, remembering what was written.
 *
 * `state` is what a previous sync is pretending to have left behind. Most of
 * these tests are about which path the sync takes given that mark, so it is the
 * first thing a test sets.
 */
function fakeFirestore(runs: StoredWorkflowRun[] = [], state?: Record<string, unknown>) {
    const written = new Map<string, StoredWorkflowRun>()
    const deleted: string[] = []
    const marks: Record<string, any>[] = []

    const snapshotOf = (docs: StoredWorkflowRun[]) => ({
        empty: docs.length === 0,
        docs: docs.map((data) => ({ data: () => data, ref: `${data.slug}_${data.runNumber}` })),
    })

    const db = {
        collection: (name: string) => {
            if (name === SYNC_STATE) {
                return {
                    doc: () => ({
                        get: async () => ({ data: () => state }),
                        set: async (data: Record<string, unknown>) => void marks.push(data),
                    }),
                }
            }
            return {
                doc: (id: string) => id,
                where: (field: string, _op: string, value: unknown) => {
                    if (field === 'pending') {
                        return { get: async () => snapshotOf(runs.filter((candidate) => candidate.pending)) }
                    }
                    if (field === 'slug') {
                        const mine = [...runs]
                            .filter((candidate) => candidate.slug === value)
                            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                        return {
                            orderBy: () => ({
                                limit: (limit: number) => ({ get: async () => snapshotOf(mine.slice(0, limit)) }),
                            }),
                        }
                    }
                    // The retention trim, which these tests give nothing to do.
                    return { limit: () => ({ get: async () => snapshotOf([]) }) }
                },
            }
        },
        batch: () => ({
            set: (id: string, data: StoredWorkflowRun) => written.set(id, data),
            commit: async () => {},
            delete: (ref: string) => deleted.push(ref),
        }),
    }

    return { db: db as any, written, deleted, marks }
}

/**
 * GitHub's list, recording exactly what was asked for.
 *
 * It honours both `perPage` and `createdSince`, and neither is a nicety: a
 * stand-in that ignored the page size let an earlier suite pass against a sync
 * downloading a hundred runs at a time, and one that ignored the filter would
 * let the cheap path look like it worked while the service fetched the lot.
 */
function fakeGitHub(runs: WorkflowRun[]) {
    const asked: { page: number; perPage: number; createdSince?: string }[] = []
    return {
        asked,
        read: async (_workflow: DispatchableWorkflow, page: number, perPage: number, createdSince?: Date) => {
            asked.push({ page, perPage, ...(createdSince ? { createdSince: createdSince.toISOString() } : {}) })
            const matching = createdSince
                ? runs.filter((candidate) => new Date(candidate.startedAt) > createdSince)
                : runs
            const from = (page - 1) * perPage
            return { ok: true as const, runs: matching.slice(from, from + perPage) }
        },
    }
}

/** A sync state as a previous run would have left it. */
const syncedAt = (at: string) => ({ syncedAt: { handicaps: at } })

describe('asking GitHub only for what is new', () => {
    it('asks for runs created since the last sync, rather than for a page of history', async () => {
        // The question almost every sync asks, and the one that decides what the
        // Operations page costs: "anything since last time?" is 36 bytes when
        // GitHub does the filtering and 1.5 MB when it does not.
        const github = fakeGitHub([run(1500), run(1499)])
        const { db } = fakeFirestore([stored(1499)], syncedAt('2026-09-19T11:00:00.000Z'))

        const result = await sync([workflow], { db, runs: github.read, now: NOW })

        expect(github.asked).toHaveLength(1)
        expect(github.asked[0]!.createdSince).toBe(
            // The last sync, less the skew margin.
            new Date(Date.parse('2026-09-19T11:00:00.000Z') - SKEW_MARGIN_MS).toISOString()
        )
        expect(result.failures).toEqual([])
    })

    it('writes what came back without first asking the archive what it already has', async () => {
        const github = fakeGitHub([run(1500)])
        const { db, written } = fakeFirestore([stored(1499)], syncedAt('2026-09-19T11:00:00.000Z'))

        const result = await sync([workflow], { db, runs: github.read, now: NOW })

        expect([...written.keys()]).toEqual(['handicaps_1500'])
        expect(result.stored).toBe(1)
    })

    it('reaches back past the window for a run whose outcome it still does not know', async () => {
        /*
         * `created` filters on when a run started existing, so a run queued
         * hours ago and finished since is *older* than the last sync and would
         * be left out — permanently, because every later window starts later
         * still. The row would read `queued` for good.
         */
        const inFlight = stored(1400, { status: 'in_progress', conclusion: null, pending: true })
        const github = fakeGitHub([run(1500), run(1400)])
        const { db, written } = fakeFirestore([stored(1499), inFlight], syncedAt('2026-09-19T11:00:00.000Z'))

        await sync([workflow], { db, runs: github.read, now: NOW })

        expect(github.asked[0]!.createdSince).toBe(
            new Date(Date.parse(inFlight.startedAt) - SKEW_MARGIN_MS).toISOString()
        )
        const repaired = written.get('handicaps_1400')
        expect(repaired).toMatchObject({ status: 'completed', conclusion: 'success' })
        expect(repaired && 'pending' in repaired).toBe(false)
    })

    it('records when it asked, so the next sync can start from there', async () => {
        const github = fakeGitHub([run(1500)])
        const { db, marks } = fakeFirestore([stored(1499)], syncedAt('2026-09-19T11:00:00.000Z'))

        await sync([workflow], { db, runs: github.read, now: NOW })

        expect(marks).toHaveLength(1)
        expect(marks[0]!.syncedAt).toEqual({ handicaps: NOW.toISOString() })
    })

    it('leaves the mark alone for a workflow that could not be read', async () => {
        // Otherwise the next sync would start from a window this one never
        // managed to look at, and the runs in between would be missed for good.
        const { db, marks } = fakeFirestore([stored(1499)], syncedAt('2026-09-19T11:00:00.000Z'))

        const result = await sync([workflow], {
            db,
            now: NOW,
            runs: async () => ({ ok: false as const, reason: 'rate-limited' as const }),
        })

        expect(result.failures).toEqual([{ slug: 'handicaps', reason: 'rate-limited' }])
        expect(marks.flatMap((mark) => Object.keys(mark.syncedAt ?? {}))).toEqual([])
    })
})

describe('refusing to send a timestamp it cannot vouch for', () => {
    /*
     * The failure this guards against does not look like a failure. GitHub
     * answers an unparseable `created` with zero runs and a 200, so a bad mark
     * would report "nothing has run" on every sync, for ever, with no error
     * anywhere. The likeliest source is this project's own stack:
     * `@google-cloud/firestore` stores a `Date` as a `Timestamp`, and a
     * `Timestamp` in a URL is garbage.
     */
    it('recognises what is and is not an instant', () => {
        expect(instantFrom('2026-09-19T11:00:00.000Z')?.toISOString()).toBe('2026-09-19T11:00:00.000Z')
        expect(instantFrom('yesterday')).toBeUndefined()
        expect(instantFrom('')).toBeUndefined()
        expect(instantFrom(undefined)).toBeUndefined()
        // What a Firestore Timestamp looks like coming back out.
        expect(instantFrom({ _seconds: 1789000000, _nanoseconds: 0 })).toBeUndefined()
    })

    it('walks the history unfiltered rather than sending a mark that will not parse', async () => {
        const github = fakeGitHub([run(1500), run(1499)])
        const { db } = fakeFirestore([stored(1499)], { syncedAt: { handicaps: 'last Tuesday' } })

        await sync([workflow], { db, runs: github.read, now: NOW, maxPages: 3 })

        // No filter at all: slower, and it cannot silently answer "nothing".
        expect(github.asked[0]).toEqual({ page: 1, perPage: PER_PAGE })
    })
})

describe('not asking at all when it just asked', () => {
    it('skips a workflow asked about seconds ago', async () => {
        // The Operations page syncs on every load, so a reload, a back button
        // and a double-click are three requests for an answer that cannot have
        // changed.
        const github = fakeGitHub([run(1500)])
        const recent = new Date(NOW.getTime() - MIN_SYNC_INTERVAL_MS / 2).toISOString()
        const { db } = fakeFirestore([stored(1500)], syncedAt(recent))

        const result = await sync([workflow], { db, runs: github.read, now: NOW })

        expect(github.asked).toEqual([])
        expect(result.throttled).toBe(1)
    })

    it('asks again once the interval has passed', async () => {
        const github = fakeGitHub([run(1500)])
        const older = new Date(NOW.getTime() - MIN_SYNC_INTERVAL_MS - 1).toISOString()
        const { db } = fakeFirestore([stored(1500)], syncedAt(older))

        const result = await sync([workflow], { db, runs: github.read, now: NOW })

        expect(github.asked).toHaveLength(1)
        expect(result.throttled).toBe(0)
    })

    it('remembers the token expiry, so a skipped call does not blank the warning', async () => {
        // The live answer rides on a response header, so a sync that made no
        // request has none. A warning about a credential that comes and goes
        // with how recently the page was opened is one nobody trusts.
        const github = fakeGitHub([run(1500)])
        const recent = new Date(NOW.getTime() - 1_000).toISOString()
        const { db } = fakeFirestore([stored(1500)], {
            ...syncedAt(recent),
            tokenExpiresAt: '2026-12-01T00:00:00.000Z',
        })

        const result = await sync([workflow], { db, runs: github.read, now: NOW })

        expect(result.tokenExpiresAt).toBe('2026-12-01T00:00:00.000Z')
    })
})

describe('meeting a workflow for the first time', () => {
    it('walks back through everything GitHub still has', async () => {
        // Nothing stored and no mark, so nothing to stop at. This is what makes
        // the archive start complete rather than filling in from today.
        const history = Array.from({ length: 250 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore()

        const result = await sync([workflow], { db, runs: github.read, now: NOW, maxPages: 10 })

        expect(github.asked).toEqual([
            { page: 1, perPage: PER_PAGE },
            { page: 2, perPage: PER_PAGE },
            { page: 3, perPage: PER_PAGE },
        ])
        expect(written.size).toBe(250)
        expect(result.stored).toBe(250)
    })

    it('does not walk further than its budget, however much history there is', async () => {
        // A page render passes a small budget for exactly this reason: an
        // unbounded walk is a request that never returns.
        const history = Array.from({ length: 5000 }, (_, index) => run(5000 - index))
        const github = fakeGitHub(history)
        const { db } = fakeFirestore()

        await sync([workflow], { db, runs: github.read, now: NOW, maxPages: 3 })

        expect(github.asked.map((call) => call.page)).toEqual([1, 2, 3])
    })

    it('stops the walk at the first run it already holds', async () => {
        const history = Array.from({ length: 450 }, (_, index) => run(1500 - index))
        const github = fakeGitHub(history)
        const { db, written } = fakeFirestore([stored(1497)])

        await sync([workflow], { db, runs: github.read, now: NOW, maxPages: 10 })

        expect(github.asked).toEqual([{ page: 1, perPage: PER_PAGE }])
        // Only the three above the high-water mark, not the hundred on the page.
        expect([...written.keys()].sort()).toEqual(['handicaps_1498', 'handicaps_1499', 'handicaps_1500'])
    })
})

describe('when things go wrong', () => {
    it('asks the workflows at once rather than one after another', async () => {
        /*
         * A barrier rather than a stopwatch: every read blocks until all three
         * have arrived, so a sync that awaits one workflow before starting the
         * next can never get past the first and the test times out instead of
         * passing slowly.
         *
         * Worth a test of its own because the serial version looked completely
         * correct — same results, same writes, five round trips one after
         * another instead of at once — and cost the Operations page several
         * seconds a load.
         */
        const workflows = ['handicaps', 'leaderboards', 'deploy'].map((slug) => ({ ...workflow, slug }))
        const { db } = fakeFirestore()

        let arrived = 0
        let release: () => void
        const everybody = new Promise<void>((resolve) => (release = resolve))

        const result = await sync(workflows, {
            db,
            now: NOW,
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

    it('keeps the pages it did read when a later one is refused', async () => {
        // The archive is append-mostly, and a partial sync is repaired by the
        // next one rather than by re-fetching what already arrived.
        const history = Array.from({ length: 250 }, (_, index) => run(1500 - index))
        const { db, written } = fakeFirestore()
        let page = 0

        const result = await sync([workflow], {
            db,
            now: NOW,
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

    it('reports a failure per workflow rather than giving up on the rest', async () => {
        const deploy: DispatchableWorkflow = { ...workflow, slug: 'deploy', file: 'deploy-site.yml' }
        const { db, written } = fakeFirestore()

        const result = await sync([workflow, deploy], {
            db,
            now: NOW,
            runs: async (which) =>
                which.slug === 'deploy'
                    ? { ok: false as const, reason: 'unauthorized' as const }
                    : { ok: true as const, runs: [run(1500)] },
        })

        expect(result.failures).toEqual([{ slug: 'deploy', reason: 'unauthorized' }])
        expect(written.has('handicaps_1500')).toBe(true)
    })

    it('marks a run that has not finished, so the next sync comes back for it', async () => {
        const github = fakeGitHub([run(1501, { status: 'in_progress', conclusion: null })])
        const { db, written } = fakeFirestore([stored(1500)])

        await sync([workflow], { db, runs: github.read, now: NOW })

        expect(written.get('handicaps_1501')).toMatchObject({ pending: true })
    })

    it('never throws, because a page render and a tick both continue without it', async () => {
        const db = {
            collection: () => ({
                doc: () => ({
                    get: async () => {
                        throw new Error('Firestore is having a bad day')
                    },
                }),
                where: () => {
                    throw new Error('Firestore is having a bad day')
                },
            }),
        }

        const result = await sync([workflow], {
            db: db as any,
            now: NOW,
            runs: async () => ({ ok: true as const, runs: [run(1500)] }),
        })

        expect(result.failures).toEqual([{ slug: 'handicaps', reason: 'unknown' }])
        expect(result.stored).toBe(0)
    })
})
