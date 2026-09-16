import parseDuration from 'parse-duration'

import type { WorkflowRun } from './github.ts'

/**
 * How often the Cloud Scheduler tick should start a workflow, and the one
 * question the tick asks about it.
 *
 * ## Why this exists
 *
 * Every workflow used to carry its own `schedule:` cron, and the tick only
 * needed a boolean: on it or not. The crons are gone — GitHub delivers them
 * hours late and the lateness is the whole reason Cloud Scheduler was
 * introduced, so keeping them meant every workflow had two clocks and one of
 * them was wrong. Measured on 2026-09-16, the last scheduled delivery of each:
 *
 *     update-handicaps.yml           5h00m late
 *     update-leaderboards.yml        5h15m late
 *     update-player-biographies.yml  4h52m late
 *     update-player-club-memberships 2h04m late, and on the wrong day
 *
 * With the tick as the only trigger, a boolean is not enough. Two of these want
 * every tick and two want roughly monthly, and a tick that fires four times a
 * day would run the monthly ones thirty times over — which for the biographies
 * means 45 Gemini calls and every biography rewritten, daily.
 *
 * ## Why an interval rather than a cron
 *
 * The obvious answer is to keep the cron strings and match them against the
 * clock. It does not work: `30 2 10,25 * *` has minute 30 and every tick is at
 * minute 0, so a literal matcher would never fire it. Aligning the crons to the
 * ticks would mean rewriting them into a form that is no longer checkable
 * against the thing it replaced.
 *
 * An interval sidesteps the arithmetic and is self-healing, which a cron is not.
 * "It has been 15 days" stays true through a tick that was missed, a service
 * that was down for a day, and a deploy that took the instance away mid-run. The
 * question is how stale the data is, which is what anybody actually cared about.
 *
 * ## What it costs
 *
 * One GitHub API call per interval-scheduled workflow per tick, to ask when it
 * last started. Four ticks a day against a 5,000/hour limit, so the cost is not
 * the rate limit — it is that the answer can fail, and `due` is deliberate about
 * what to do then.
 */

export type Cadence =
    /** Every tick. What the two daily scrapes want. */
    | 'tick'
    /** Never on the tick. The button on `/operations`, and nothing else. */
    | 'manual'
    /**
     * Dispatch when the last run started longer ago than this.
     *
     * A duration string, parsed by `parse-duration`: `'15d'`, `'4h'`, `'1w'`,
     * `'36h'`, and the spelled-out `'15 days'` if that reads better at the call
     * site. Compound works too — `'1h30m'`.
     *
     * ## The one that will catch somebody
     *
     * **`'3m'` is three minutes, not three months.** Months are `'3mo'`. That is
     * `parse-duration`'s convention and it is the usual one, but it is the
     * opposite of what somebody writing a monthly cadence means to type, and
     * getting it wrong turns a monthly scrape into one that runs on every tick.
     * Prefer `'90d'` over `'3mo'` for anything on this list: days are what the
     * intervals are actually reasoned about in, and a number of days cannot be
     * misread.
     *
     * ## Why a library rather than `itty-time`, which is already here
     *
     * `itty-time`'s `ms()` is used in `@hector/wisegolf` and would have meant no
     * new dependency. It does not take the compact forms — `ms('7d')` is `NaN` —
     * and, worse, `ms('15 dayz')` returns **15**. Fifteen milliseconds: a typo
     * would make a fortnightly job due on every tick, for ever, with nothing
     * anywhere reporting a problem.
     *
     * `parse-duration` returns `null` for anything it cannot read, which is the
     * behaviour worth having. It has no dependencies of its own.
     */
    | { every: string }

export type Due =
    | { due: true; because: string }
    | { due: false; because: string }

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/**
 * How long ago, at the coarsest resolution that is still useful.
 *
 * The same judgement `runs.ts` makes about workflow runs: the question these
 * strings answer is "is this stale", not "exactly when", and they are read on
 * the Operations page and in Cloud Logging rather than parsed.
 */
function inWords(elapsed: number): string {
    if (elapsed >= DAY) {
        const days = Math.floor(elapsed / DAY)
        return `${days} ${days === 1 ? 'day' : 'days'}`
    }
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/**
 * Whether the tick should start this workflow now.
 *
 * `latest` is the most recent run GitHub knows about, or `undefined` when there
 * are none — a workflow that has never run is due, which is what makes a fresh
 * project start working rather than waiting a fortnight for a first run it will
 * never have had.
 *
 * `latest` being `null` means something different and is treated as such: the
 * run history could not be read. That is the case worth being deliberate about.
 * Dispatching anyway would mean a GitHub outage runs the biographies on every
 * tick — 45 Gemini calls apiece — precisely when nothing can confirm whether it
 * already ran. So an unreadable history is *not* due, and says so. There are
 * four ticks a day and the next one will almost certainly get an answer; a
 * fortnightly job can afford to wait six hours, and cannot afford to run four
 * times a day for a week.
 */
export function due(cadence: Cadence, latest: WorkflowRun | undefined | null, now: Date): Due {
    if (cadence === 'manual') return { due: false, because: 'started by hand only' }
    if (cadence === 'tick') return { due: true, because: 'every tick' }

    const interval = parseDuration(cadence.every)
    if (interval === null || interval === undefined || interval <= 0) {
        // A cadence that cannot be read is a typo in this repository rather than
        // anything happening at runtime, and `cadence.test.ts` fails on it before
        // it can ship. Handled anyway, and handled as *not* due, because the
        // alternative is a workflow whose interval says nothing running on every
        // tick — which for the biographies is 45 Gemini calls a tick.
        console.error('A workflow has an unreadable cadence and will not be dispatched', { every: cadence.every })
        return { due: false, because: `'${cadence.every}' is not a duration this can read` }
    }

    if (latest === null) {
        return { due: false, because: 'could not read the run history, so staleness is unknown' }
    }
    if (latest === undefined) {
        return { due: true, because: 'has never run' }
    }

    const started = new Date(latest.startedAt).getTime()
    if (Number.isNaN(started)) {
        // A run whose timestamp cannot be parsed is the same situation as no
        // history: we do not know how stale it is, and guessing "due" is the
        // expensive guess.
        return { due: false, because: 'the last run has an unreadable start time' }
    }

    const elapsed = now.getTime() - started
    const because = `last ran ${inWords(elapsed)} ago, and wants every ${cadence.every}`
    return elapsed >= interval ? { due: true, because } : { due: false, because }
}
