import type { Firestore } from '@google-cloud/firestore'

import { type HandicapHistoryEntry, latestPerDay } from '@hector/schemas/src/handicaps.ts'

import { firestore } from '../firestore.ts'

/**
 * Every player's latest known handicap, in one derived document.
 *
 * ## Why a derived document exists at all
 *
 * `handicap-observations` remains the only source of truth here; this adds
 * nothing to it and can be deleted at any time without losing a fact. What it
 * adds is a way to answer "what is everyone's handicap right now" without
 * reading the whole log to find out — which is the question every admin page
 * listing players asks, on every load.
 *
 * The log is 1,408 documents and append-only, so it only grows. Against a free
 * tier of 50,000 reads a day, a page that scans it costs about 3% of the
 * allowance per view, and the job already spends 6,000 of them on its four runs.
 * A handful of roster loads and a refresh or two would be the most expensive
 * thing this service does, for a value that changes about 2.7 times a day.
 *
 * ## What it is deliberately not
 *
 * **Not a build input.** The site's player pages draw a handicap *history*
 * chart, so the build needs the whole log regardless, and
 * `/api/handicaps/history` already serves it. Pointing the build at a document
 * derived from that log would recreate, in a new shape, the problem that "a
 * backup that is also the build input is not a backup": a generated artifact on
 * the production path,
 * with the thing it was generated from no longer being read. This is for the
 * admin UI.
 *
 * **Not the number a player page shows.** `player.handicap` on the site resolves
 * as `override ?? fromHistory` — see `astrosite/src/code/players.ts` — where the
 * override is a stopgap somebody typed for a player WiseGolf has never heard of.
 * This document holds only the second half of that expression, so a caller can
 * still tell "WiseGolf says 5.2" from "a person typed 5.2 because WiseGolf does
 * not know this player". Baking the resolution in here would make the two
 * indistinguishable everywhere downstream, permanently, to save one `??`.
 */

/**
 * One collection holding exactly one document.
 *
 * A Firestore path alternates collections and documents, so a single document
 * still needs a collection around it, and giving it its own is what keeps the
 * name honest — `handicap-snapshots/latest` says what is there, where
 * `handicaps/snapshot` would suggest a collection of handicaps that this is not.
 *
 * ## One document, and the arithmetic behind it
 *
 * 45 players at roughly 60 bytes each — a kebab-case id, a number and an ISO
 * instant — is about 3KB against Firestore's 1 MiB per-document limit. The
 * ceiling is therefore somewhere north of 15,000 players, which this club will
 * not reach. Written down because "one document for everything" is a decision
 * that is either obviously fine or a cliff, and the difference is arithmetic
 * worth doing once rather than assuming twice.
 *
 * The alternative — a document per player — costs 45 reads per page load rather
 * than one, which is most of the saving this exists for.
 */
export const SNAPSHOTS = 'handicap-snapshots'
export const LATEST = 'latest'

/** What the history says about one player, and nothing else. */
export type PlayerHandicap = {
    handicap: number
    /**
     * When that reading was taken, when we know. Absent rather than null for the
     * 1,397 entries written before the field existed — which is not a corner
     * case in this document but the normal one, since 29 of the 40 players in
     * the history have not moved since. Firestore rejects `undefined` outright,
     * so writing it as an absent key is load-bearing rather than tidy.
     */
    observed?: string
}

export type HandicapSnapshot = {
    /**
     * When this was last recomputed, as an ISO instant.
     *
     * Not derivable from the contents: `observed` says when a handicap last
     * *moved*, and the interesting failure is a snapshot nothing has rewritten
     * for a week while handicaps carried on moving. A reader with only the
     * observations cannot tell that from a quiet week.
     */
    generated: string
    /** Player id to what the history says. Every player it has ever heard of. */
    players: Record<string, PlayerHandicap>
}

/**
 * The snapshot the whole history implies, recomputed from scratch.
 *
 * Pure, and the entire derivation: `latestPerDay` already answers "one entry per
 * player per day, the last thing observed that day", and it is ordered oldest
 * first, so assigning each entry in turn leaves the newest standing. Doing it
 * this way rather than writing a second "latest per player" means the snapshot
 * cannot disagree with the daily view the site reads — there is only one
 * implementation of what "latest" means, in `@hector/schemas`.
 *
 * `generated` is a parameter rather than a call to the clock, so that this file
 * holds no ambient state and a test can assert the whole document rather than
 * everything except one field. The job already passes its own `now()` around for
 * the same reason.
 */
export function snapshotOf(entries: readonly HandicapHistoryEntry[], generated: string): HandicapSnapshot {
    const players: Record<string, PlayerHandicap> = {}
    for (const entry of latestPerDay(entries)) {
        players[entry.player] =
            entry.observed === undefined
                ? { handicap: entry.handicap }
                : { handicap: entry.handicap, observed: entry.observed }
    }
    return { generated, players }
}

export type SnapshotOptions = { db?: Firestore; now?: Date }

/**
 * Rebuild the snapshot from the complete history and write it.
 *
 * ## Recompute, never patch
 *
 * The whole document is computed from every observation and written over what
 * was there, exactly as `render()` rebuilds the NDJSON backup from the whole log
 * rather than appending to it. The tempting alternative — write the players this
 * run changed — fails the same way, and the plan says why: a run that dies
 * halfway leaves the stores permanently apart and the next run finds nothing to
 * do, because it only ever looks at what it changed itself. Recomputing means
 * every run repairs the last one, so a crash costs a tick rather than a silent
 * wrong number that nobody has a reason to look at again.
 *
 * `set` without `{ merge: true }` is what makes that true, and it is a choice
 * rather than a default worth inheriting quietly: merging would leave a player
 * dropped from the roster in the map forever, at their last known handicap, with
 * nothing anywhere saying the value is no longer being maintained.
 *
 * ## Why it takes the entries
 *
 * The one caller is the handicaps job, which already holds the full history: it
 * reads the log once per run and passes the result around. Reading it again here
 * would put the scan count back where step 1 found it — four scans a run, 23,000
 * reads a day — for data the caller is holding in a variable.
 *
 * So the job's wiring is one line, `await write([...history, ...entries])`,
 * after the insert and next to the render that keeps git in step.
 */
export async function write(
    entries: readonly HandicapHistoryEntry[],
    options: SnapshotOptions = {}
): Promise<HandicapSnapshot> {
    const db = options.db ?? firestore()
    const snapshot = snapshotOf(entries, (options.now ?? new Date()).toISOString())
    await db.collection(SNAPSHOTS).doc(LATEST).set(snapshot)
    return snapshot
}

/**
 * The snapshot, or `undefined` when nothing has written one yet.
 *
 * Missing is a normal answer rather than an error: the collection is empty until
 * the first run that writes it, an emulator someone just started has nothing in
 * it, and — until the job is wired up — production does not have one either. So
 * callers fall back rather than fail, which for the roster means the stopgap
 * field it read before this existed.
 *
 * Read without a schema, unlike the observations. Those are reconciled in from a
 * file in git that predates the collection; this document is written by `write`
 * above and by nothing else, so a parse here would be checking this module
 * against itself. The one way it can be wrong — somebody editing it by hand in
 * the console — is the same way the run log can be, and is not what a `z.parse`
 * would catch in time to help.
 */
export async function read(options: SnapshotOptions = {}): Promise<HandicapSnapshot | undefined> {
    const db = options.db ?? firestore()
    const document = await db.collection(SNAPSHOTS).doc(LATEST).get()
    return document.exists ? (document.data() as HandicapSnapshot) : undefined
}
