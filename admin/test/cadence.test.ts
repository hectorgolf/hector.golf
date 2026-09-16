import { describe, expect, it } from 'vitest'

import { type Cadence, due } from '../src/lib/cadence.ts'
import type { WorkflowRun } from '../src/lib/github.ts'
import { DISPATCHABLE_WORKFLOWS } from '../src/lib/workflows.ts'

/**
 * Which workflows a tick starts, now that the tick is the only clock.
 *
 * The GitHub `schedule:` crons were deleted on 2026-09-16, so a mistake here is
 * not "runs on the wrong schedule" — it is "never runs again, and nothing goes
 * red". These pin the two answers that are expensive to get wrong in opposite
 * directions: a fortnightly job dispatched on every tick, and a daily job never
 * dispatched at all.
 */

const NOW = new Date('2026-09-16T12:00:00Z')

const ranDaysAgo = (days: number): WorkflowRun => ({
    status: 'completed',
    conclusion: 'success',
    startedAt: new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    event: 'workflow_dispatch',
    runNumber: 1,
    url: 'https://github.com/hectorgolf/hector.golf/actions/runs/1',
})

describe('a workflow that wants every tick', () => {
    it('is always due, without asking GitHub anything', () => {
        expect(due('tick', undefined, NOW).due).toBe(true)
    })
})

describe('a workflow that is started by hand only', () => {
    it('is never due', () => {
        expect(due('manual', undefined, NOW).due).toBe(false)
    })

    it('stays not due even if it has not run for a year', () => {
        expect(due('manual', ranDaysAgo(365), NOW).due).toBe(false)
    })
})

describe('a workflow on an interval', () => {
    const fortnightly: Cadence = { every: '15d' }

    it('is due when the interval has elapsed', () => {
        expect(due(fortnightly, ranDaysAgo(15), NOW).due).toBe(true)
        expect(due(fortnightly, ranDaysAgo(40), NOW).due).toBe(true)
    })

    it('is not due before then', () => {
        expect(due(fortnightly, ranDaysAgo(14), NOW).due).toBe(false)
        expect(due(fortnightly, ranDaysAgo(0), NOW).due).toBe(false)
    })

    it('is due when it has never run', () => {
        // A fresh project would otherwise wait a fortnight for a first run it
        // has never had, which is to say for ever.
        expect(due(fortnightly, undefined, NOW)).toEqual({ due: true, because: 'has never run' })
    })

    it('says how stale it is, in both directions', () => {
        expect(due(fortnightly, ranDaysAgo(20), NOW).because).toBe('last ran 20 days ago, and wants every 15d')
        expect(due(fortnightly, ranDaysAgo(3), NOW).because).toBe('last ran 3 days ago, and wants every 15d')
    })
})

describe('when the run history cannot be read', () => {
    it('is not due, and says why', () => {
        /*
         * The expensive direction. Dispatching on an unreadable history means a
         * GitHub outage runs the biographies on every tick — 45 Gemini calls
         * each, and every biography rewritten — at exactly the moment nothing
         * can confirm whether it already ran.
         *
         * Four ticks a day means the next one very likely gets an answer. A
         * fortnightly job can afford six hours; it cannot afford four runs a day
         * for a week.
         */
        expect(due({ every: '15d' }, null, NOW)).toEqual({
            due: false,
            because: 'could not read the run history, so staleness is unknown',
        })
    })

    it('treats an unparseable start time the same way', () => {
        const broken = { ...ranDaysAgo(99), startedAt: 'not a date' }
        expect(due({ every: '15d' }, broken, NOW).due).toBe(false)
    })

    it('does not stop a tick-scheduled workflow, which never asks', () => {
        // `'tick'` is due by definition, so GitHub being unreadable must not
        // take the handicaps scrape down with it.
        expect(due('tick', null, NOW).due).toBe(true)
    })
})

describe('the deploy backstop', () => {
    it('does not fire while deploys are happening normally', () => {
        // A scrape dispatches the deploy when it commits. The daily interval is
        // only there for when that request fails.
        expect(due({ every: '1d' }, ranDaysAgo(0.25), NOW).due).toBe(false)
    })

    it('fires once a day has passed with no deploy at all', () => {
        expect(due({ every: '1d' }, ranDaysAgo(1.1), NOW).due).toBe(true)
    })
})

describe('the duration syntax', () => {
    it('takes the compact forms', () => {
        expect(due({ every: '7d' }, ranDaysAgo(8), NOW).due).toBe(true)
        expect(due({ every: '7d' }, ranDaysAgo(6), NOW).due).toBe(false)
        expect(due({ every: '1w' }, ranDaysAgo(8), NOW).due).toBe(true)
        expect(due({ every: '4h' }, ranDaysAgo(0.5), NOW).due).toBe(true)
        expect(due({ every: '36h' }, ranDaysAgo(1), NOW).due).toBe(false)
    })

    it('takes the spelled-out forms too, for where they read better', () => {
        expect(due({ every: '15 days' }, ranDaysAgo(16), NOW).due).toBe(true)
        expect(due({ every: '15 days' }, ranDaysAgo(14), NOW).due).toBe(false)
    })

    it('reads `3m` as three minutes, not three months', () => {
        /*
         * The trap worth pinning rather than only documenting. `m` is minutes
         * and `mo` is months, which is the usual convention and the opposite of
         * what somebody writing a monthly cadence types. Getting it wrong turns
         * a monthly scrape into one that runs on every tick.
         */
        expect(due({ every: '3m' }, ranDaysAgo(0.01), NOW).due).toBe(true)
        expect(due({ every: '3mo' }, ranDaysAgo(60), NOW).due).toBe(false)
        expect(due({ every: '3mo' }, ranDaysAgo(120), NOW).due).toBe(true)
    })

    it('refuses a duration it cannot read, rather than guessing', () => {
        /*
         * `itty-time`, already a dependency of this repository, would have meant
         * no new package — and answers `ms('15 dayz')` with **15**. Fifteen
         * milliseconds: a typo would make a fortnightly job due on every tick,
         * for ever, silently. This is why the parser was chosen for its failure
         * mode rather than its syntax.
         */
        for (const nonsense of ['15 dayz', '', 'abc', 'soon']) {
            expect(due({ every: nonsense }, ranDaysAgo(365), NOW).due).toBe(false)
        }
    })

    it('refuses a zero or negative interval, which would mean every tick', () => {
        expect(due({ every: '0d' }, ranDaysAgo(1), NOW).due).toBe(false)
        expect(due({ every: '-5d' }, ranDaysAgo(1), NOW).due).toBe(false)
    })
})

describe('every cadence this repository actually configures', () => {
    it('is one the parser can read', () => {
        /*
         * The test that matters most. A mistyped duration is not a runtime
         * condition — it is a typo in `workflows.ts` — and its consequence is a
         * workflow that silently never runs again, or one that runs on every
         * tick. Neither shows up as a failure anywhere. This fails in CI instead.
         */
        const intervals = DISPATCHABLE_WORKFLOWS.filter(
            (workflow) => typeof workflow.cadence === 'object'
        )
        expect(intervals.length).toBeGreaterThan(0)

        for (const workflow of intervals) {
            const verdict = due(workflow.cadence, undefined, NOW)
            // `undefined` history means "never run", which is due for any
            // readable interval — so a `false` here can only be an unreadable one.
            expect(verdict, `${workflow.file}: ${verdict.because}`).toEqual({
                due: true,
                because: 'has never run',
            })
        }
    })
})
