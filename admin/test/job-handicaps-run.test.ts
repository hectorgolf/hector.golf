import { describe, expect, it } from 'vitest'

import type { HandicapCheck } from '@hector/schemas/src/handicap-checks.ts'
import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import {
    BACKUP_PATH,
    CHECKS_BACKUP_PATH,
    type HandicapReader,
    type JobDependencies,
    LEGACY_CHECKS_PATH,
    LEGACY_PATH,
    parse,
    run,
} from '../src/lib/jobs/handicaps.ts'

/**
 * What a whole run does, in what order, and what it refuses to do.
 *
 * `job-handicaps.test.ts` covers the decisions — `decide`, `scrape`, `sweepOf`
 * — and until `JobDependencies` grew the Firestore and WiseGolf seams, that was
 * the whole of it. `run` itself had no test, which made the one function that
 * writes five things the one function nothing held to anything. The rules it
 * carries are not in any of the pieces: they are in the order the pieces are
 * called in, and two of them are the plan's load-bearing ones.
 *
 * **Reconcile before deciding.** The legacy file's rows have to reach `history`
 * before `decide` sees it, or every player the old pipeline knew about reads as
 * changed-from-nothing.
 *
 * **A shadow run concludes what a real one concludes.** It differs in what it
 * writes, not in what it decides. An earlier version decided against Firestore
 * directly, so on a dry run — where the reconcile writes nothing — it compared
 * against an empty store and reported all 45 players as new, on every tick.
 *
 * `job-shadow.test.ts` already covers that second rule and keeps covering it,
 * but from the other side: it rebuilds the expression `run` uses and asserts the
 * expression is right, because reaching `run` was not possible. It would still
 * pass if `run` stopped using it. These fail.
 */

const NOON = new Date('2026-09-16T12:00:00.000Z')
const TODAY = '2026-09-16'
const INSTANT = '2026-09-16T12:00:00Z'

const player = (id: string): Player => ({ id, name: { first: id, last: 'Player' }, club: 'Tapiola Golf' }) as Player

const source = (answers: Record<string, number | undefined>): HandicapReader => ({
    name: 'TestSource',
    getPlayerHandicap: async (first: string) => answers[first],
})

type Recorded = {
    added: HandicapHistoryEntry[]
    addedChecks: HandicapCheck[]
    snapshots: Array<{ entries: HandicapHistoryEntry[]; now: Date }>
    commits: Array<{ path: string; text: string; message: string }>
    /** What the bucket recompute rewrote. Its own rules are `job-buckets.test.ts`. */
    replaced: Array<{ path: string; text: string; message: string }>
    sourcesBuilt: number
}

/**
 * A run with nothing real behind it.
 *
 * Defaults describe the ordinary tick — one player, one source answering, both
 * stores empty, both legacy files absent — and each test overrides the one thing
 * it is about. `recorded` is what the run did, in the order it did it.
 */
function harness(over: Partial<JobDependencies> = {}, files: Record<string, string> = {}) {
    const recorded: Recorded = {
        added: [],
        addedChecks: [],
        snapshots: [],
        commits: [],
        replaced: [],
        sourcesBuilt: 0,
    }

    const dependencies: JobDependencies = {
        readFile: async (path) => files[path],
        commit: async (path, text, message) => {
            recorded.commits.push({ path, text, message })
            return { ok: true, commit: `sha-${recorded.commits.length}` }
        },
        /*
         * No events, so the bucket recompute at the end of a run has nothing to
         * redraw and these are never reached. Present because `run` calls it,
         * and overridable by a test that wants to watch it — what the recompute
         * decides is `job-buckets.test.ts`, not this file.
         */
        listDirectory: async () => [],
        replace: async (path, text, message) => {
            recorded.replaced.push({ path, text, message })
            return { ok: true, commit: `buckets-${recorded.replaced.length}` }
        },
        now: () => NOON,
        observations: async () => [],
        addObservations: async (entries) => {
            recorded.added.push(...entries)
        },
        checks: async () => [],
        addChecks: async (checks) => {
            recorded.addedChecks.push(...checks)
        },
        writeSnapshot: async (entries, now) => {
            recorded.snapshots.push({ entries: [...entries], now })
        },
        players: async () => [player('a')],
        sources: async () => {
            recorded.sourcesBuilt += 1
            return [source({ a: 14.7 })]
        },
        ...over,
    }

    return { dependencies, recorded }
}

const legacyFile = (entries: HandicapHistoryEntry[]) => JSON.stringify(entries)

describe('the order a run does things in', () => {
    it('reconciles the legacy file into the store', async () => {
        const old: HandicapHistoryEntry = { player: 'a', date: '2026-09-01', handicap: 14.7 }
        const { dependencies, recorded } = harness({}, { [LEGACY_PATH]: legacyFile([old]) })

        await run(dependencies, false)

        expect(recorded.added).toContainEqual(old)
    })

    it('decides against the reconciled history, not against the store it read', async () => {
        /*
         * The assertion the reconcile exists for, and the one that fails if the
         * two steps are ever reordered. Firestore has nothing; the legacy file
         * says this player is 14.7; WiseGolf says 14.7. Nothing has moved, so a
         * run that decided against Firestore alone would report a change,
         * write an observation and commit — on every tick, for every player the
         * old pipeline knew about.
         */
        const old: HandicapHistoryEntry = { player: 'a', date: '2026-09-01', handicap: 14.7 }
        const { dependencies, recorded } = harness({}, { [LEGACY_PATH]: legacyFile([old]) })

        const result = await run(dependencies, false)

        expect(result.changes).toEqual([])
        expect(recorded.added).toEqual([old])
    })

    it('reconciles the sweep log the same way', async () => {
        const sweep: HandicapCheck = { at: '2026-09-15T03:00:00Z', checked: 40, skipped: [] }
        const { dependencies, recorded } = harness({}, { [LEGACY_CHECKS_PATH]: legacyFile([sweep] as never) })

        await run(dependencies, false)

        expect(recorded.addedChecks).toContainEqual(sweep)
    })

    it('checks the roster before logging in to WiseGolf', async () => {
        /*
         * Order, not politeness. Building the sources reads a secret out of
         * Secret Manager and logs in; a run that is about to fail because
         * Firestore has no players should not do either first, and the failure a
         * reader sees should be the roster rather than a login that succeeded on
         * the way to one.
         */
        const { dependencies, recorded } = harness({ players: async () => [] })

        const result = await run(dependencies, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('no players in Firestore')
        expect(recorded.sourcesBuilt).toBe(0)
    })
})

describe('a shadow run', () => {
    const changed = { players: async () => [player('a')], sources: async () => [source({ a: 12.1 })] }

    it('reaches the same conclusion a real run would', async () => {
        const shadow = await run(harness(changed).dependencies, true)
        const real = await run(harness(changed).dependencies, false)

        expect(shadow.changes).toEqual(real.changes)
        expect(shadow.changes).toEqual([{ subject: 'a', from: undefined, to: '12.1' }])
    })

    it('still decides against what the reconcile would have written', async () => {
        // The regression this is here for: on a dry run the reconcile writes
        // nothing, so a run that asked Firestore what it holds would see an
        // empty store and call every player new.
        const old: HandicapHistoryEntry = { player: 'a', date: '2026-09-01', handicap: 14.7 }
        const { dependencies } = harness({}, { [LEGACY_PATH]: legacyFile([old]) })

        expect((await run(dependencies, true)).changes).toEqual([])
    })

    it('touches neither store nor GitHub', async () => {
        const { dependencies, recorded } = harness(changed, {
            [LEGACY_PATH]: legacyFile([{ player: 'b', date: '2026-09-01', handicap: 3.3 }]),
        })

        const result = await run(dependencies, true)

        expect(result.outcome).toBe('ok')
        expect(recorded.added).toEqual([])
        expect(recorded.addedChecks).toEqual([])
        expect(recorded.snapshots).toEqual([])
        expect(recorded.commits).toEqual([])
    })
})

describe('what a real run writes', () => {
    it('records an observation for a handicap that moved', async () => {
        const { dependencies, recorded } = harness({ sources: async () => [source({ a: 12.1 })] })

        await run(dependencies, false)

        expect(recorded.added).toEqual([{ player: 'a', date: TODAY, handicap: 12.1, observed: INSTANT }])
    })

    it('records a sweep even when nothing moved', async () => {
        // The sweep attests to the scrape, not to a change. `lastCheckedFor`
        // reads this log to answer "when were these handicaps last confirmed",
        // and a quiet day is exactly when that question gets asked.
        const { dependencies, recorded } = harness({
            observations: async () => [{ player: 'a', date: '2026-09-01', handicap: 14.7 }],
        })

        const result = await run(dependencies, false)

        expect(result.changes).toEqual([])
        expect(recorded.added).toEqual([])
        expect(recorded.addedChecks).toEqual([{ at: INSTANT, checked: 1, skipped: [] }])
    })

    it('rebuilds the snapshot on every run, including a quiet one', async () => {
        const held: HandicapHistoryEntry = { player: 'a', date: '2026-09-01', handicap: 14.7 }
        const { dependencies, recorded } = harness({ observations: async () => [held] })

        await run(dependencies, false)

        // Unconditional, so that "is the snapshot current?" is answered by the
        // run log rather than by working out which runs happened to change
        // something.
        expect(recorded.snapshots).toEqual([{ entries: [held], now: NOON }])
    })

    it('hands the snapshot the whole history, not just what this run found', async () => {
        const held: HandicapHistoryEntry = { player: 'b', date: '2026-09-01', handicap: 3.3 }
        const { dependencies, recorded } = harness({
            observations: async () => [held],
            players: async () => [player('a'), player('b')],
            sources: async () => [source({ a: 12.1, b: 3.3 })],
        })

        await run(dependencies, false)

        // Recompute-never-patch: the document is every player's latest, so a run
        // that handed it only its own findings would drop everyone who did not
        // move today.
        expect(recorded.snapshots[0].entries).toEqual([
            held,
            { player: 'a', date: TODAY, handicap: 12.1, observed: INSTANT },
        ])
    })

    it('commits both backups', async () => {
        const { dependencies, recorded } = harness({ sources: async () => [source({ a: 12.1 })] })

        await run(dependencies, false)

        expect(recorded.commits.map((c) => c.path)).toEqual([BACKUP_PATH, CHECKS_BACKUP_PATH])
        expect(parse(recorded.commits[0].text)).toEqual([
            { player: 'a', date: TODAY, handicap: 12.1, observed: INSTANT },
        ])
    })

    it('says in the message whether anything moved', async () => {
        const quiet = harness({ observations: async () => [{ player: 'a', date: '2026-09-01', handicap: 14.7 }] })
        await run(quiet.dependencies, false)
        expect(quiet.recorded.commits[0].message).toBe('Reconcile the handicap observation log')

        const moved = harness({ sources: async () => [source({ a: 12.1 })] })
        await run(moved.dependencies, false)
        expect(moved.recorded.commits[0].message).toBe("Update 1 player's handicap")

        const several = harness({
            players: async () => [player('a'), player('b')],
            sources: async () => [source({ a: 12.1, b: 3.3 })],
        })
        await run(several.dependencies, false)
        expect(several.recorded.commits[0].message).toBe("Update 2 players' handicap")
    })

    it('stamps every write with one instant', async () => {
        /*
         * The snapshot's `generated`, the observation's `observed` and the
         * sweep's `at` all describe the same moment. `run` asks the clock once
         * for that reason, and three calls seconds apart would make one run look
         * like three to anyone reconstructing a morning afterwards.
         */
        const { dependencies, recorded } = harness({ sources: async () => [source({ a: 12.1 })] })

        await run(dependencies, false)

        expect(recorded.added[0].observed).toBe(INSTANT)
        expect(recorded.addedChecks[0].at).toBe(INSTANT)
        expect(recorded.snapshots[0].now).toBe(NOON)
    })
})

describe('a scrape that reached nobody', () => {
    it('fails, and attests to nothing', async () => {
        // Not a commit and not a sweep: the sources are down or the login is
        // wrong, and recording a check would publish a run that learned nothing
        // as though it had confirmed every handicap.
        const { dependencies, recorded } = harness({ sources: async () => [source({})] })

        const result = await run(dependencies, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('no handicap source answered')
        expect(recorded.addedChecks).toEqual([])
        expect(recorded.commits).toEqual([])
        expect(recorded.snapshots).toEqual([])
    })

    it('says how many players it asked about', async () => {
        const { dependencies } = harness({
            players: async () => [player('a'), player('b')],
            sources: async () => [source({})],
        })

        expect((await run(dependencies, false)).detail).toContain('2 players')
    })
})

describe('when a commit fails', () => {
    const failing = (path: string): Partial<JobDependencies> => ({
        commit: async (attempted) =>
            attempted === path ? { ok: false, detail: `refused ${attempted}` } : { ok: true, commit: 'sha' },
    })

    it('fails the run when the observation log will not commit', async () => {
        const result = await run(harness(failing(BACKUP_PATH)).dependencies, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toBe(`refused ${BACKUP_PATH}`)
    })

    it('fails the run when the sweep log will not commit', async () => {
        /*
         * Worth its own test rather than assuming the first covers it. Both
         * commits are attempted before either result is examined, so the second
         * failure is reported by a separate branch — one that a refactor
         * collapsing the two checks into the first would silently drop, leaving
         * a run that lost the sweep log reporting `ok`.
         */
        const result = await run(harness(failing(CHECKS_BACKUP_PATH)).dependencies, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toBe(`refused ${CHECKS_BACKUP_PATH}`)
    })

    it('still reports what it found', async () => {
        const { dependencies } = harness({ ...failing(BACKUP_PATH), sources: async () => [source({ a: 12.1 })] })

        expect((await run(dependencies, false)).changes).toEqual([{ subject: 'a', from: undefined, to: '12.1' }])
    })
})
