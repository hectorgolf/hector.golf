import type { Change, JobRun } from './log.ts'

/**
 * Turning a job run into what a person standing in front of the button wants to
 * know.
 *
 * The counterpart to `lib/runs.ts`, which does the same for a GitHub workflow
 * run, and separate from it for the reason those two are separate at all: a
 * workflow run is GitHub's record and has a conclusion, a run number and a URL,
 * while a job run is ours and has an outcome, a change list and no page to link
 * to. Forcing one shape over both would mean inventing halves of each.
 */

export type JobTone = 'good' | 'bad' | 'neutral'

export function toneOfJob(run: JobRun): JobTone {
    if (run.outcome === 'failed') return 'bad'
    if (run.outcome === 'skipped') return 'neutral'
    return 'good'
}

/**
 * The outcome as a word, with shadow runs called what they are.
 *
 * A dry run that "succeeded" succeeded at deciding, not at writing, and the
 * whole point of the shadow period is that nobody confuses the two. It is on the
 * pill rather than in a footnote because the pill is what gets read.
 */
export function labelOfJob(run: JobRun): string {
    if (run.outcome === 'failed') return 'failed'
    if (run.outcome === 'skipped') return 'skipped'
    return run.dryRun ? 'shadow' : 'success'
}

/**
 * What the run changed, in one line.
 *
 * Named up to a point and counted past it, the same way `persistHandicapCheckToDisk`
 * writes its commit message: a run that moved two handicaps is worth reading in
 * full, and one that moved the whole roster is worth a number.
 */
export function changesInWords(changes: readonly Change[]): string {
    if (changes.length === 0) return 'nothing changed'
    const named = changes
        .slice(0, 3)
        .map((change) => `${change.subject} ${change.from ?? '—'} → ${change.to}`)
        .join(', ')
    return changes.length > 3 ? `${named}, and ${changes.length - 3} more` : named
}

/** Who asked, shortened for a table cell. */
export function requesterInWords(run: JobRun): string {
    if (run.by === 'the schedule') return 'the schedule'
    // An IAP-forwarded email. The local part is enough to tell two admins apart,
    // and the domain is the same for everybody who can reach this page.
    return run.by.includes('@') ? run.by.split('@')[0]! : run.by
}
