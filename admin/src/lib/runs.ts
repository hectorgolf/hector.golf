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
