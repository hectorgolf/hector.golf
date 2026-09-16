import { COLLECTIONS, snapshotKey } from './collections.ts'
import { firestore } from '../firestore.ts'

/**
 * Every collection the site builds from, in one payload.
 *
 * ## Why one document rather than seven endpoints
 *
 * The build wants all of it, and wants it to agree with itself. Seven requests
 * can straddle a write — a leaderboard read after an event was updated but
 * before the player was — and the resulting site would be internally
 * inconsistent in a way nothing would flag. One request cannot.
 *
 * It is about 400KB, which is small enough that the simple thing is also the
 * right thing. If that stops being true the answer is a Firestore transaction
 * around the seven reads rather than seven endpoints.
 *
 * ## Shape
 *
 * Collections come back as arrays, in the order `COLLECTIONS` declares them, and
 * keyed in the payload by the camelCase form of the collection name. Records are
 * returned exactly as stored — no re-validation on the way out, deliberately:
 * `migrate.ts` validates on the way in, and a record that has been in Firestore
 * for a year should not become unreadable because a schema was tightened. The
 * site validates what it uses, as it always has.
 */

export type Snapshot = {
    generatedAt: string
    [collection: string]: unknown
}

export async function snapshot(): Promise<Snapshot> {
    const database = firestore()

    // Sequential rather than parallel. Seven small reads against a database that
    // scales to zero, from a service that also does, and the parallel version
    // buys milliseconds in exchange for seven concurrent connections during a
    // cold start.
    const payload: Snapshot = { generatedAt: new Date().toISOString() }
    for (const collection of COLLECTIONS) {
        const documents = await database.collection(collection.name).get()
        payload[snapshotKey(collection)] = documents.docs.map((document) => document.data())
    }
    return payload
}
