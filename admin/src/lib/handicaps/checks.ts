import type { Firestore } from '@google-cloud/firestore'

import { type HandicapCheck, compareChecks, schema as HandicapCheckSchema } from '@hector/schemas/src/handicap-checks.ts'

import { firestore } from '../firestore.ts'

/**
 * The sweep log, in Firestore.
 *
 * The sibling of `observations.ts`, and deliberately built the same way — same
 * five functions, same reconcile-and-render shape — because it is the same
 * problem: an append-only log with no human writer, scraped on a schedule, kept
 * in git as a backup rather than as the source.
 *
 * ## What it records, which is not what the observation log records
 *
 * `handicap-observations` says what changed; this says that we looked. A quiet
 * day is where they come apart: a player whose handicap has not moved since
 * August has no observation to cite, and "we checked at 03:02 this morning and it
 * is still 15.4" is the sentence the events page needs. Without this log that
 * sentence is unsayable, because the sweep's own timestamp is discarded when
 * nothing changes.
 *
 * That difference has a consequence for this migration specifically. Where the
 * observation log gains a row only when a handicap moves, this gains one on
 * *every* sweep — so while both pipelines are running, it grows at twice its
 * usual rate rather than occasionally being one row ahead. See `render` below.
 */

export const CHECKS = 'handicap-checks'

/**
 * A sweep's identity, which is the instant it read the sources.
 *
 * Unique across all 36 committed entries, and unique by construction going
 * forward: a sweep takes tens of seconds and nothing runs two at once — the
 * lease in `jobs/lock.ts` is what makes that true rather than merely likely.
 *
 * No composite key is needed, unlike the observation log, whose entries are
 * about a player and a day and needed `observed` bolted on to tell two readings
 * apart. A sweep is about a moment, and the moment is the whole of its identity.
 */
export function documentId(check: HandicapCheck): string {
    return check.at
}

export type StoreOptions = { db?: Firestore }

/** Every sweep, oldest first. */
export async function all(options: StoreOptions = {}): Promise<HandicapCheck[]> {
    const db = options.db ?? firestore()
    const snapshot = await db.collection(CHECKS).get()
    return snapshot.docs.map((document) => HandicapCheckSchema.parse(document.data())).sort(compareChecks)
}

/**
 * Which of `candidates` the store does not already hold.
 *
 * Pure and separate from the write, for the reason `observations.ts` gives at
 * length: a writer that re-read the collection to find out what was missing is
 * how that module came to scan 1,400 documents four times a run.
 */
export function missingFrom(
    stored: readonly HandicapCheck[],
    candidates: readonly HandicapCheck[],
): HandicapCheck[] {
    const known = new Set(stored.map(documentId))
    return candidates.filter((check) => !known.has(documentId(check)))
}

/**
 * Write sweeps that are known not to exist.
 *
 * `create` rather than `set`: a sweep is a fact about a moment and rewriting one
 * is never correct, so a document that unexpectedly exists should fail the run
 * rather than be silently overwritten. The caller filters with `missingFrom`
 * first, which is safe because the job holds the lease while it runs.
 *
 * Batched at 400 like its sibling, though it will not need to be: the whole
 * committed history is 36 entries and a run adds one.
 */
export async function insert(checks: readonly HandicapCheck[], options: StoreOptions = {}): Promise<void> {
    if (checks.length === 0) return
    const db = options.db ?? firestore()

    for (let index = 0; index < checks.length; index += 400) {
        const batch = db.batch()
        for (const check of checks.slice(index, index + 400)) {
            batch.create(db.collection(CHECKS).doc(documentId(check)), check)
        }
        await batch.commit()
    }
}

/**
 * The NDJSON backup, rendered from a list of sweeps.
 *
 * One JSON object per line, oldest first, with a trailing newline. The key order
 * is fixed here rather than left to whatever order the properties happen to be
 * in, for the same reason the observation log fixes it: a rendered line that
 * differs from a committed line only by key order is a line the append-only
 * guard refuses, and it would refuse every one of them, on the run after a
 * refactor nobody thought was risky.
 *
 * `approximate` is omitted when absent rather than written as `false`. The schema
 * is emphatic that its absence is what tells a real sweep from a reconstructed
 * one "forever", and writing a `false` would erase that distinction on the
 * entries that predate the field while pretending to preserve it.
 *
 * ## Why NDJSON, where the old file was a JSON array
 *
 * The append-only guard in `jobs/backup.ts` is line-oriented: it checks that
 * every committed line is still there, unchanged, in order. A JSON array cannot
 * be guarded that way, because appending to one rewrites the brackets and the
 * indentation of its neighbours — every append would look like a wholesale
 * rewrite and the guard would refuse it. The format is not a preference; it is
 * what makes the backup guardable.
 */
export function render(checks: readonly HandicapCheck[]): string {
    const ordered = [...checks].sort(compareChecks)
    const lines = ordered.map((check) =>
        JSON.stringify({
            at: check.at,
            checked: check.checked,
            skipped: check.skipped,
            ...(check.approximate === undefined ? {} : { approximate: check.approximate }),
        }),
    )
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/** The inverse of `render`, for reading a backup back in. */
export function parse(ndjson: string): HandicapCheck[] {
    return ndjson
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => HandicapCheckSchema.parse(JSON.parse(line)))
}
