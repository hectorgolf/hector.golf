import { Firestore } from "@google-cloud/firestore";

import type { Event } from "@hector/schemas/src/events.ts";
import type { HandicapCheck } from "@hector/schemas/src/handicap-checks.ts";
import type { HandicapHistoryEntry } from "@hector/schemas/src/handicaps.ts";
import type { Player } from "@hector/schemas/src/players.ts";

/**
 * Where the scrapes write, now that they do not write files.
 *
 * ## What this replaces
 *
 * Every scrape used to end the same way: `writeJsonFile` to somewhere under
 * `src/data/`, then `scripts/commit-changes.sh` to commit and push it. The files
 * are gone — see `docs/plans/everything-to-firestore.md` — so the scrapes write
 * documents instead, and the commit step is gone with them.
 *
 * Three things follow that are worth knowing before changing anything here.
 *
 * **There is no commit, so there is no review.** A scrape that writes nonsense
 * used to leave a diff on `main` that a person could read and revert. Now it
 * overwrites a document. The generated `snapshot.json` is the only remaining
 * copy, and it is refreshed *after* the fact rather than being the write itself.
 *
 * **There is no `git pull -r && git push`, so the `data-update` concurrency
 * group is no longer load-bearing for correctness.** It stays in the workflow
 * files, because two scrapes writing the same player at once is still a race —
 * just one Firestore resolves by last-write-wins rather than by failing a push.
 *
 * **Writes are per document.** The old writers rewrote a whole file, so a
 * partial run left a file that was either old or new. A partial run now leaves
 * some documents updated and others not, which is a state the file-based version
 * could not produce. For these scrapes that is acceptable — each document is
 * independent and the next run repairs it — but it is not acceptable for
 * anything with an invariant spanning two documents, and nothing here has one.
 *
 * ## Credentials
 *
 * Application Default Credentials, the same way `admin/scripts/seed.ts` gets
 * them: the workflows authenticate with `google-github-actions/auth` through
 * Workload Identity Federation before running the scrape. On a laptop,
 * `gcloud auth application-default login`.
 */

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "hector-golf";

/**
 * The database, which is named rather than default.
 *
 * `hector` and not `(default)`, because this project has no default database and
 * the miss is silent: reads come back empty rather than failing. The admin's
 * `src/lib/firestore.ts` carries the full story and the same default.
 */
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? "hector";

/**
 * Built on first use rather than at import.
 *
 * `update-handicaps.ts` is imported by its tests for `fetchUpdatedPlayerRecords`,
 * and constructing a Firestore client resolves credentials — so an import would
 * require a laptop to be authenticated in order to run the unit tests.
 */
let client: Firestore | undefined;

function firestore(): Firestore {
    client ??= new Firestore({ projectId: PROJECT, databaseId: DATABASE });
    return client;
}

/** Where each kind of record lives. Mirrors `admin/src/lib/data/collections.ts`. */
const PLAYERS = "players";
const EVENTS = "events";
const LEADERBOARDS = "leaderboards";
const CLUBS = "clubs";
const HANDICAP_OBSERVATIONS = "handicap-observations";
const HANDICAP_CHECKS = "handicap-checks";

/**
 * The document id for an observation.
 *
 * Kept identical to the admin's, which is the only thing making the two writers
 * agree about what a duplicate is. If this ever diverges, a re-run inserts a
 * second copy of every reading instead of overwriting.
 */
export const observationId = (entry: HandicapHistoryEntry): string =>
    `${entry.player}_${entry.date}_${entry.observed ?? "unstamped"}`;

export async function writePlayer(player: Player): Promise<void> {
    await firestore().collection(PLAYERS).doc(player.id).set(player);
}

export async function writeEvent(event: Event): Promise<void> {
    await firestore().collection(EVENTS).doc(event.id).set(event);
}

export async function writeLeaderboard(eventId: string, leaderboard: unknown): Promise<void> {
    await firestore().collection(LEADERBOARDS).doc(eventId).set(leaderboard as object);
}

/**
 * Replace the clubs lookup wholesale.
 *
 * `update-player-biographies` regenerates the whole list from WiseGolf, so this
 * deletes what is there rather than merging: a club that has left WiseGolf's
 * list should leave ours, and a merge would keep it forever.
 *
 * Not a transaction. 140 clubs is more than a transaction's 500-write limit
 * allows comfortably once deletes are counted, and a half-replaced lookup is
 * repaired by the next run — this list changes about once a year.
 */
export async function replaceClubs(clubs: Array<{ abbreviation: string }>): Promise<void> {
    const database = firestore();
    const existing = await database.collection(CLUBS).get();
    const wanted = new Set(clubs.map((club) => club.abbreviation));

    const deletions = database.batch();
    let toDelete = 0;
    for (const document of existing.docs) {
        if (!wanted.has(document.id)) {
            deletions.delete(document.ref);
            toDelete += 1;
        }
    }
    if (toDelete > 0) await deletions.commit();

    for (let index = 0; index < clubs.length; index += 400) {
        const batch = database.batch();
        for (const club of clubs.slice(index, index + 400)) {
            batch.set(database.collection(CLUBS).doc(club.abbreviation), club);
        }
        await batch.commit();
    }
}

/**
 * Add observations that are not already there.
 *
 * `create` rather than `set`: an observation is a fact about a moment, and
 * rewriting one is never correct. A run that somehow produces an id that already
 * exists should leave the original alone, and the `alreadyExists` rejection is
 * how that is noticed rather than silently absorbed.
 */
export async function appendObservations(entries: readonly HandicapHistoryEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const database = firestore();
    let written = 0;

    for (const entry of entries) {
        try {
            await database.collection(HANDICAP_OBSERVATIONS).doc(observationId(entry)).create(entry);
            written += 1;
        } catch (error) {
            // gRPC 6 is ALREADY_EXISTS. Anything else is a real failure.
            if ((error as { code?: number })?.code === 6) {
                console.warn(`Observation ${observationId(entry)} is already recorded; leaving it alone`);
            } else {
                throw error;
            }
        }
    }
    return written;
}

/** Record that a sweep happened, keyed by its instant. */
export async function appendHandicapCheck(check: HandicapCheck): Promise<void> {
    await firestore().collection(HANDICAP_CHECKS).doc(check.at).set(check);
}

/** Every observation recorded so far, for the scrapes that compare against it. */
export async function readObservations(): Promise<HandicapHistoryEntry[]> {
    const snapshot = await firestore().collection(HANDICAP_OBSERVATIONS).get();
    return snapshot.docs.map((document) => document.data() as HandicapHistoryEntry);
}

/** Every sweep recorded so far. */
export async function readHandicapChecks(): Promise<HandicapCheck[]> {
    const snapshot = await firestore().collection(HANDICAP_CHECKS).get();
    return snapshot.docs.map((document) => document.data() as HandicapCheck);
}
