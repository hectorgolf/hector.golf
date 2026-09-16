import {
    EventFormat,
    genericEventSchema,
    matchplayEventSchema,
    type Event,
    type MatchplayEvent,
} from '@hector/schemas/src/events.ts'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

import { firestore } from '../firestore.ts'

/**
 * Reading and writing Hector's data.
 *
 * Documents are stored as a JSON string in a `doc` field rather than as native
 * Firestore maps. Two reasons, both learned the hard way elsewhere: Firestore
 * cannot store an array of arrays, which `hector` events' `buckets` are; and a
 * blob keeps the Zod schema the single validator, so nothing is silently
 * reshaped on the way in or out. The cost is that Firestore cannot query inside
 * a document — which does not matter for eighteen events and forty-five players.
 *
 * `updatedAt` and `updatedBy` sit outside the blob deliberately. They are about
 * the record rather than in it, and they are the beginning of the provenance the
 * data-ownership decision will need.
 */

type StoredDocument = {
    doc: string
    updatedAt: string
    updatedBy: string
}

const EVENTS = 'events'
const PLAYERS = 'players'

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown, id: string): T | undefined {
    const stored = raw as Partial<StoredDocument> | undefined
    if (!stored?.doc) return undefined
    const result = schema.safeParse(JSON.parse(stored.doc))
    if (!result.success) {
        // Loud, because a document that fails validation vanishing silently is
        // exactly the behaviour the site's loader was criticised for.
        console.error(`Stored document ${id} does not match its schema; skipping it`)
        return undefined
    }
    return result.data
}

/**
 * Every event, whatever format it is played in.
 *
 * Parsed through the discriminated union rather than through one format's
 * schema, because the collection holds all three. Reading it as matchplay would
 * make thirteen Hector events look like thirteen corrupt documents and log an
 * error for each on every page load.
 */
export async function listEvents(): Promise<Event[]> {
    const snapshot = await firestore().collection(EVENTS).get()
    return snapshot.docs
        .map((d) => parse<Event>(genericEventSchema, d.data(), d.id))
        .filter((e): e is Event => e !== undefined)
        .sort((a, b) => b.timing.start.localeCompare(a.timing.start))
}

/** How many events of each format the store holds, for the Events landing page. */
export async function countEventsByFormat(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const event of await listEvents()) {
        counts[event.format] = (counts[event.format] ?? 0) + 1
    }
    return counts
}

export async function listMatchplayEvents(): Promise<MatchplayEvent[]> {
    const events = await listEvents()
    return events.filter((e): e is MatchplayEvent => e.format === EventFormat.Matchplay)
}

/**
 * Undefined for an id that is not a matchplay event, the same as for one that
 * does not exist: a caller holding a matchplay route has no use for a Hector
 * event, and conflating the two here would push the check into every page.
 */
export async function getMatchplayEvent(id: string): Promise<MatchplayEvent | undefined> {
    const doc = await firestore().collection(EVENTS).doc(id).get()
    if (!doc.exists) return undefined
    const event = parse<Event>(genericEventSchema, doc.data(), id)
    return event?.format === EventFormat.Matchplay ? event : undefined
}

/**
 * Validates before writing. The admin UI is the one writer that could put a
 * malformed event into the store, so it is the one place worth refusing to.
 */
export async function saveMatchplayEvent(event: MatchplayEvent, updatedBy: string): Promise<void> {
    const validated = matchplayEventSchema.parse(event)
    const record: StoredDocument = {
        doc: JSON.stringify(validated),
        updatedAt: new Date().toISOString(),
        updatedBy,
    }
    await firestore().collection(EVENTS).doc(validated.id).set(record)
}

/**
 * Removes a tournament, and refuses to remove anything else.
 *
 * The guard is the point. The admin owns matchplay and only matchplay — every
 * other format in this collection is a mirror a scheduled job writes, so
 * deleting one here would either be undone on the next tick or, worse, survive
 * until the next export published the hole to the public site. Reading the
 * document first costs one round trip and makes the wrong id a no-op instead.
 *
 * There is no undo in Firestore. There is one in git: the event's committed JSON
 * under `astrosite/src/data/events/matchplay/` is removed by the next export, as
 * a reviewable commit, so a deletion made in error is recovered by reverting it
 * and seeding. The log line below is the other half of that trail — it is the
 * only provenance a deletion can leave, `updatedBy` having gone with the record.
 *
 * Returns false when the id is not a matchplay event, whether because it is a
 * Hector event or because it is nothing at all; the caller has the same thing to
 * say about either.
 */
export async function deleteMatchplayEvent(id: string, deletedBy: string): Promise<boolean> {
    const event = await getMatchplayEvent(id)
    if (!event) return false

    await firestore().collection(EVENTS).doc(id).delete()
    console.log(`Deleted matchplay event ${id} ("${event.name}") on behalf of ${deletedBy}`)
    return true
}

export async function eventExists(id: string): Promise<boolean> {
    return (await firestore().collection(EVENTS).doc(id).get()).exists
}

export async function listPlayers(): Promise<Player[]> {
    const snapshot = await firestore().collection(PLAYERS).get()
    return snapshot.docs
        .map((d) => parse<Player>(playerSchema, d.data(), d.id))
        .filter((p): p is Player => p !== undefined)
        .sort((a, b) => `${a.name.first} ${a.name.last}`.localeCompare(`${b.name.first} ${b.name.last}`))
}
