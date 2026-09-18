import type { Firestore } from '@google-cloud/firestore'

/**
 * How long the run log keeps a run, and the trim that enforces it.
 *
 * Shared by both halves — the jobs this service runs itself (`job-runs`) and the
 * mirror of the workflows GitHub runs (`workflow-runs`) — because they are one
 * list on the page. Two horizons would mean a log that is complete down to a
 * date and then half-complete below it, which is worse than either horizon on
 * its own: a reader scrolling past the boundary would see the workflows stop and
 * conclude they stopped running.
 */

/**
 * How long to keep a run.
 *
 * Trimmed rather than kept forever, unlike the observation log this service
 * writes. The distinction is the one `handicap-checks.json` already draws: the
 * observations are the data and are kept for good; this is operational history,
 * useful for months rather than years.
 *
 * ## Why an age and not a count
 *
 * The job log used to keep the last fifty runs per job, which is a retention
 * policy written in the wrong unit: fifty runs is a fortnight at four ticks a
 * day and two days if somebody spends an afternoon pressing the button, so the
 * window shrank exactly when it was being used. An age says what the log is
 * actually for — "what has this service been doing lately" — in a unit the
 * question is asked in, and it does not move when the tick rate changes.
 *
 * Half a year, because that is a Finnish golf season and a bit: the handicap
 * sweeps stop mattering in October and start again in April, and a question
 * about last season's behaviour that arrives in March can still be answered. It
 * is also twice GitHub's own 90-day retention, which is the point of mirroring
 * its runs at all — past that date this archive is the only copy.
 *
 * The storage is nothing: six runs a day for six months is about a thousand
 * documents per workflow or job, each a few hundred bytes.
 */
export const KEEP_FOR_DAYS = 180

/**
 * How many expired runs one trim may delete.
 *
 * A bound rather than a target. Ordinarily a run expires at the same rate runs
 * are written, so this finds one or two; the cases where it finds a thousand are
 * the interesting ones — a retention window that was just shortened, or a log
 * that nothing has written to since before the cutoff — and neither is a reason
 * for a single tick to issue a thousand deletes. Firestore's batch limit is 500
 * writes, so this also has to stay under that.
 */
export const TRIM_BATCH = 200

/** The moment a run has to be newer than to survive this trim. */
export const cutoff = (now: Date): string =>
    new Date(now.getTime() - KEEP_FOR_DAYS * 24 * 60 * 60 * 1000).toISOString()

/**
 * Drop the runs that have aged out of one collection.
 *
 * Across the whole collection rather than per job or per workflow, and that is
 * the cheaper shape as well as the truer one: retention is a property of the log
 * rather than of each thing that writes to it, so one query answers it however
 * many of them there are — and a single inequality on one field is served by the
 * automatic index rather than by a composite one somebody has to remember to
 * create.
 *
 * It also costs almost nothing on the runs where there is nothing to do, which
 * is nearly all of them: the query reads only the documents it is about to
 * delete.
 *
 * Best-effort by contract. Both callers do their real work first and tidy up
 * afterwards, so a throw here would report a run that happened as a run that
 * failed; they catch, and this is written to be caught.
 */
export async function trimByAge(db: Firestore, collection: string, now: Date): Promise<void> {
    const snapshot = await db.collection(collection).where('startedAt', '<', cutoff(now)).limit(TRIM_BATCH).get()
    if (snapshot.empty) return

    const batch = db.batch()
    for (const document of snapshot.docs) batch.delete(document.ref)
    await batch.commit()
}
