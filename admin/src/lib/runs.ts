import type { WorkflowRun } from './github.ts'

/**
 * Turning a workflow run into the two things a person standing in front of the
 * "Run now" button actually wants to know: did the last one work, and was it
 * recent enough that pressing this would be pointless.
 *
 * Separate from `github.ts` so it can be tested without a fetch, and separate
 * from the page so the wording is not buried in markup.
 */

/**
 * How long ago, in words, at the coarsest useful resolution.
 *
 * Deliberately vague above an hour. The question this answers is "is this stale"
 * and not "exactly when", and a run that says `4 hours ago` makes the case for
 * pressing the button better than one that says `2026-09-13T07:45:05Z` — which
 * is also rendered, in the tooltip, for when the exact moment does matter.
 */
export function ageInWords(startedAt: string, now: Date = new Date()): string {
    const started = new Date(startedAt)
    if (Number.isNaN(started.getTime())) return 'at an unknown time'

    const seconds = Math.round((now.getTime() - started.getTime()) / 1000)
    // A clock skew of a few seconds between GitHub and Cloud Run should read as
    // "just now" rather than as a run that starts in the future.
    if (seconds < 90) return 'just now'

    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} minutes ago`

    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

    const days = Math.round(hours / 24)
    return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/**
 * The exact moment, in UTC, to the second: `2026-09-13 03:00:24`.
 *
 * To the second on purpose, and this is the log's whole point. A column of
 * `03:00:24`, `03:00:19`, `03:01:06` is how somebody reading this page knows the
 * next run is tonight at three — the pattern *is* the answer, and it is a more
 * trustworthy one than a predicted "next run" would be, since a prediction would
 * be this code's copy of a schedule that actually lives in Terraform and could
 * quietly disagree with it.
 *
 * UTC rather than the reader's timezone because the admin ships no client
 * JavaScript, so the server would have to guess — and because every schedule in
 * this project is written in UTC, so a column in Helsinki time would be the one
 * thing on the page that could not be compared with the rest of it.
 */
export function formatUtc(startedAt: string): string {
    const started = new Date(startedAt)
    if (Number.isNaN(started.getTime())) return 'unknown'
    // `2026-09-13T03:00:24.000Z` → `2026-09-13 03:00:24`
    return started.toISOString().replace('T', ' ').slice(0, 19)
}

export type RunTone = 'running' | 'good' | 'bad' | 'neutral'

/**
 * Which of the pill styles a run's outcome deserves. `cancelled` and `skipped`
 * are neither good news nor bad, so they get neither colour.
 */
export function toneOf(run: WorkflowRun): RunTone {
    if (run.status !== 'completed') return 'running'
    if (run.conclusion === 'success') return 'good'
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'bad'
    return 'neutral'
}

/** What the pill says: the conclusion once there is one, the status until then. */
export function labelOf(run: WorkflowRun): string {
    return run.status === 'completed' ? (run.conclusion ?? 'completed') : run.status.replace('_', ' ')
}

/**
 * How the run was started, in words a reader recognises from this page.
 *
 * `workflow_dispatch` covers both a Cloud Scheduler call and somebody pressing
 * the button, because GitHub cannot tell them apart — the dispatch API says who
 * the *token* belongs to and both use the same one. The distinction is in this
 * service's own logs when it matters.
 */
export function triggerInWords(run: WorkflowRun): string {
    if (run.event === 'workflow_dispatch') return 'on request'
    if (run.event === 'schedule') return "GitHub's own cron"
    return run.event
}
