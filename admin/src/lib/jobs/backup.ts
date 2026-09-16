/**
 * The rule that makes the file in git a backup rather than a mirror.
 *
 * ## The problem this solves
 *
 * Once Firestore is the system of record, the committed file is rendered from it
 * on every run. That is what makes the two stores self-healing — a run that
 * writes Firestore and then dies before committing is repaired by the next run,
 * rather than leaving a permanent divergence nobody notices.
 *
 * It also means a bad write to Firestore is faithfully copied into the backup on
 * the next tick. A backup whose only job is to survive a mistake in the thing it
 * is backing up does not survive that, and the loss is discovered weeks later
 * with nothing to recover from. `docs/current/data-ownership.md` puts the same
 * point the other way round: the repository being the database is what makes the
 * fix for a bad edit a revert.
 *
 * ## The rule
 *
 * Every line that has ever been committed must still be there, unchanged, in the
 * same order. New lines may only be added at the end. Anything else — a line
 * removed, a line edited, lines reordered — is refused, loudly, and the run
 * fails without committing.
 *
 * This is stricter than "is a superset", and deliberately. A render that emits
 * the same set in a different order is not a disaster, but it is a bug, and one
 * that would otherwise show up as a diff touching every line of a file nobody
 * reads. Refusing it is how that bug gets found in the week it is introduced.
 *
 * ## What it cannot catch
 *
 * A wrong value *appended* is still appended. The guard protects the history,
 * not the newest row. That is the right division: the newest row is what the
 * acceptance criterion in `docs/plans/handicaps-to-firestore.md` compares
 * against the old pipeline, and the history is what nothing else protects.
 */

export type GuardVerdict =
    /** Nothing to do: the render is identical to what is committed. */
    | { verdict: 'unchanged' }
    /** Safe to commit: everything already there is intact, and there is more. */
    | { verdict: 'append'; added: number }
    /** Refuse. `detail` is a sentence for the run log. */
    | { verdict: 'refuse'; detail: string }

/**
 * Compare a rendered file against what is committed.
 *
 * Both are compared as lines rather than as text, because a trailing newline is
 * not a change worth refusing over and is easy to get wrong in a renderer. The
 * empty-string entries a trailing newline produces are dropped from both sides
 * before comparing, so "the file ends with a newline" is not load-bearing here —
 * the renderer decides that, and it is checked by the round-trip test instead.
 */
export function guard(committed: string | undefined, rendered: string): GuardVerdict {
    const before = lines(committed ?? '')
    const after = lines(rendered)

    if (after.length < before.length) {
        return {
            verdict: 'refuse',
            detail: `the render has ${before.length - after.length} fewer lines than the committed file`,
        }
    }

    for (let index = 0; index < before.length; index += 1) {
        if (before[index] !== after[index]) {
            // The differing content is deliberately not in the message. These
            // lines are observations about named people, the detail is written to
            // a Firestore document the Operations page renders, and "line 812
            // changed" is the actionable half anyway. The full diff is in the
            // commit that was refused, which is to say in the logs.
            return {
                verdict: 'refuse',
                detail: `line ${index + 1} of the committed file would be rewritten, and history is append-only`,
            }
        }
    }

    const added = after.length - before.length
    return added === 0 ? { verdict: 'unchanged' } : { verdict: 'append', added }
}

function lines(text: string): string[] {
    // Split on \n and drop a single trailing empty entry. Not `.filter(Boolean)`:
    // a blank line in the middle of the file is a corruption this should refuse,
    // not something to quietly skip past on both sides so that it compares equal.
    const split = text.split('\n')
    if (split.length > 0 && split[split.length - 1] === '') split.pop()
    return split
}
