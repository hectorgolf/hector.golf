import type { Firestore } from '@google-cloud/firestore'

import {
    type HandicapHistoryEntry,
    compareObservations,
    schema as HandicapHistoryEntrySchema,
} from '@hector/schemas/src/handicaps.ts'

import { firestore } from '../firestore.ts'

/**
 * The handicap observation log, in Firestore.
 *
 * ## Observations, not changes
 *
 * The collection is `handicap-observations` because that is what the entries
 * are, and because the codebase is emphatic about it: `compareObservations`,
 * `observationsOn`, and the schema comment explaining that a day can hold more
 * than one reading. A row is written when a value differs from what we held, so
 * calling the collection `handicap-changes` would be *almost* right — and almost
 * right is how `latestPerDay` came to be needed in the first place.
 */

export const OBSERVATIONS = 'handicap-observations'

/**
 * A *total* order over observations: day, then when it was seen, then who it is
 * about.
 *
 * `compareObservations` from `@hector/schemas` is the ordering the site reads by,
 * and it is not total — it returns 0 for two entries sharing a date and an
 * `observed`, which is not a corner case here but the normal one. A sweep stamps
 * every reading it takes with a single instant, so a morning that moved nine
 * handicaps produces nine entries that the comparator considers equal.
 *
 * `Array.sort` is stable, so those nine come out in whatever order they went in,
 * which means the rendered file would be a function of the order Firestore
 * happened to return documents in rather than of the data. Two effects, both
 * bad: the backup's line order could change without any observation changing,
 * and the append-only guard would refuse the result — correctly, since a
 * reordering *is* a rewrite of history as far as it can tell.
 *
 * So the render breaks the tie on `player`, and `compareObservations` is left
 * alone: it is the site's contract, its documented semantics are about days
 * rather than about determinism, and widening it here would be changing a shared
 * schema to fix a local problem.
 */
export function compareForRendering(a: HandicapHistoryEntry, b: HandicapHistoryEntry): number {
    return compareObservations(a, b) || a.player.localeCompare(b.player)
}

/**
 * The document id for an entry.
 *
 * Entries carry no id of their own. They never needed one: the file was a list,
 * and the old writer de-duplicated so that a `(player, date)` pair was unique.
 * Firestore needs one, and it has to be derived from the entry rather than
 * generated, or the git-to-Firestore reconcile inserts every entry again on
 * every run.
 *
 * `observed` joins the key because a day can now legitimately hold two readings
 * — the Golf Union re-runs a failed nightly batch during office hours — and
 * keying on `(player, date)` alone would silently drop the second. It is
 * optional in the schema, because the 1,397 entries written before the field
 * existed genuinely have no observation time, so those key as `unstamped`.
 *
 * That is safe rather than merely convenient, and the test asserts it rather
 * than assuming it: every unstamped entry predates the change that allowed two
 * readings a day, so unstamped entries are unique per `(player, date)` by
 * construction.
 *
 * The colon is not available — Firestore document ids may not contain `/`, and
 * `:` is legal but reads as a path separator in the console — so `_` it is.
 * Player ids are kebab-case and dates are ISO, so nothing here can collide by
 * containing the separator.
 */
export function documentId(entry: HandicapHistoryEntry): string {
    return `${entry.player}_${entry.date}_${entry.observed ?? 'unstamped'}`
}

export type StoreOptions = { db?: Firestore }

/**
 * Every observation, oldest first.
 *
 * Ordered in the process rather than by a Firestore query, for two reasons. The
 * ordering has to be exactly `compareForRendering` or the rendered backup
 * differs from the committed one by a permutation and the guard refuses it; and
 * an unstamped `observed` is absent rather than null in these documents, which a
 * Firestore `orderBy` would drop from the results entirely.
 *
 * ## What it costs, and why it is still the right shape
 *
 * One scan is ~1,400 document reads and grows with a log that is append-only and
 * never pruned — call it 2,400 in a year. At four runs a day that is 6,000 reads
 * today and 10,000 in a year, against a free tier of 50,000 a day. Comfortable.
 *
 * It is worth stating the number because it was wrong once. This comment used to
 * claim 8,400 a day on the assumption of one scan per run, while `run()` in fact
 * scanned four times — two of its own and two inside a writer that re-read the
 * collection to find out what was missing. That was 23,000 reads a day, and
 * closer to 39,000 a year from now: most of the allowance, for a job whose
 * output is a handful of rows. Callers read once now and pass the result around.
 *
 * Reading everything rather than only what changed is still deliberate. The
 * render is compared against the committed file in full, and that comparison is
 * the one thing making the two stores self-healing.
 */
export async function all(options: StoreOptions = {}): Promise<HandicapHistoryEntry[]> {
    const db = options.db ?? firestore()
    const snapshot = await db.collection(OBSERVATIONS).get()
    const entries = snapshot.docs.map((document) => HandicapHistoryEntrySchema.parse(document.data()))
    return entries.sort(compareForRendering)
}

/**
 * Which of `candidates` the store does not already hold.
 *
 * Pure, and separate from the write, because the alternative cost more than it
 * looked. This used to live inside the writer, which read the whole collection
 * to find out what was missing — and the job called the writer twice and `all()`
 * twice more, so one run scanned a 1,400-document collection four times.
 *
 * At four runs a day that was 23,000 reads against a free tier of 50,000, rising
 * with a log that is append-only and never pruned: about 78% of the allowance a
 * year from now, for a job whose entire output is a handful of rows. The caller
 * now reads once and passes the result around.
 *
 * Keyed on `documentId`, so "already holds" means exactly what a `create` would
 * mean by it.
 */
export function missingFrom(
    stored: readonly HandicapHistoryEntry[],
    candidates: readonly HandicapHistoryEntry[]
): HandicapHistoryEntry[] {
    const known = new Set(stored.map(documentId))
    return candidates.filter((entry) => !known.has(documentId(entry)))
}

/**
 * Write observations that are known not to exist.
 *
 * `create` rather than `set`, per entry: an observation is a fact about a moment
 * and rewriting one is never correct, so a document that unexpectedly exists
 * should fail the run rather than be silently overwritten.
 *
 * That makes the caller responsible for having filtered with `missingFrom`
 * first, which is safe here because the job holds the lease while it runs and
 * nothing else writes this collection. A failure therefore means a real bug, and
 * is worth hearing about.
 *
 * Firestore batches cap at 500 writes. The first reconcile writes 1,406, so that
 * is not a limit to respect politely — it is the first run. A batch that fails
 * partway leaves the earlier batches committed, which the next run repairs
 * because it reads the collection and filters again.
 */
export async function insert(entries: readonly HandicapHistoryEntry[], options: StoreOptions = {}): Promise<void> {
    if (entries.length === 0) return
    const db = options.db ?? firestore()

    for (let index = 0; index < entries.length; index += 400) {
        const batch = db.batch()
        for (const entry of entries.slice(index, index + 400)) {
            batch.create(db.collection(OBSERVATIONS).doc(documentId(entry)), entry)
        }
        await batch.commit()
    }
}

/**
 * The NDJSON backup, rendered from a list of observations.
 *
 * One JSON object per line, in `compareForRendering` order, with a trailing
 * newline. The key order within each object is fixed here rather than left to
 * whatever order the properties happen to be in, because a rendered line that
 * differs from a committed line only by key order is a line the append-only
 * guard refuses — and it would refuse every line, on the run after a refactor
 * nobody thought was risky.
 *
 * `observed` is omitted when absent rather than written as null, matching what
 * `handicaps.json` holds for the entries that predate the field.
 */
export function render(entries: readonly HandicapHistoryEntry[]): string {
    const ordered = [...entries].sort(compareForRendering)
    const lines = ordered.map((entry) =>
        JSON.stringify(
            { date: entry.date, player: entry.player, handicap: entry.handicap, observed: entry.observed }
        )
    )
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/** The inverse of `render`, for reading a backup back in. */
export function parse(ndjson: string): HandicapHistoryEntry[] {
    return ndjson
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => HandicapHistoryEntrySchema.parse(JSON.parse(line)))
}
