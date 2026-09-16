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
 * Reading the whole collection every run is 1,400 document reads against a free
 * tier of 50,000 a day, at six runs a day. That is 8,400, and the alternative —
 * reading only what changed — would mean the render could not be compared
 * against the committed file, which is the one thing making this self-healing.
 */
export async function all(options: StoreOptions = {}): Promise<HandicapHistoryEntry[]> {
    const db = options.db ?? firestore()
    const snapshot = await db.collection(OBSERVATIONS).get()
    const entries = snapshot.docs.map((document) => HandicapHistoryEntrySchema.parse(document.data()))
    return entries.sort(compareForRendering)
}

/**
 * Add entries that are not there yet, and report how many were new.
 *
 * `create` rather than `set`, per entry, inside a batch: an entry that already
 * exists must not be rewritten, because rewriting it is how a reconcile turns
 * into a silent edit of history. The pre-read below is what keeps the batch from
 * failing on the first duplicate — `create` on an existing document throws,
 * which for a reconcile that runs on every tick would mean it fails every time
 * after the first.
 */
export async function insertMissing(
    entries: readonly HandicapHistoryEntry[],
    options: StoreOptions = {}
): Promise<HandicapHistoryEntry[]> {
    const db = options.db ?? firestore()
    if (entries.length === 0) return []

    const existing = new Set((await all(options)).map(documentId))
    const missing = entries.filter((entry) => !existing.has(documentId(entry)))
    if (missing.length === 0) return []

    // Firestore batches cap at 500 writes. The first reconcile writes 1,406, so
    // this is not a theoretical limit to respect politely — it is the first run.
    for (let index = 0; index < missing.length; index += 400) {
        const batch = db.batch()
        for (const entry of missing.slice(index, index + 400)) {
            batch.create(db.collection(OBSERVATIONS).doc(documentId(entry)), entry)
        }
        await batch.commit()
    }
    return missing
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
            entry.observed === undefined
                ? { date: entry.date, player: entry.player, handicap: entry.handicap }
                : { date: entry.date, player: entry.player, handicap: entry.handicap, observed: entry.observed }
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
