import {
    EventFormat,
    genericEventSchema,
    type Event,
    type MatchplayEvent,
} from '@hector/schemas/src/events.ts'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

import { firestore } from '../firestore.ts'
import { OWNED_FORMATS, PLAYERS_ARE_OWNED } from '../ownership.ts'

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

/** The member of the union a format names, so a page gets that format's fields. */
type EventOfFormat<F extends EventFormat> = Extract<Event, { format: F }>

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

/**
 * The one event of a given format, narrowed to that format's type.
 *
 * Every page under `/events/<format>/` wants exactly this, and wants the same
 * answer — undefined — for an id that does not exist and for one that belongs to
 * another format. A caller holding a Hector route has no use for a matchplay
 * tournament, and conflating the two here would push the check into every page.
 *
 * Generic rather than one function per format because the difference between
 * them was the format literal and nothing else, and step 0 of
 * `docs/plans/authoring-players-and-events.md` asks for the write side to be
 * generalised the same way. Doing the read half first costs nothing and is what
 * the read-only pages are built on; the write half carries an ownership refusal
 * with it, which is a decision rather than a refactor.
 */
export async function getEventOfFormat<F extends EventFormat>(
    id: string,
    format: F
): Promise<EventOfFormat<F> | undefined> {
    const doc = await firestore().collection(EVENTS).doc(id).get()
    if (!doc.exists) return undefined
    const event = parse<Event>(genericEventSchema, doc.data(), id)
    return event?.format === format ? (event as EventOfFormat<F>) : undefined
}

/** Every event of one format, newest first, the way `listEvents` orders them. */
export async function listEventsOfFormat<F extends EventFormat>(format: F): Promise<EventOfFormat<F>[]> {
    const events = await listEvents()
    return events.filter((e): e is EventOfFormat<F> => e.format === format)
}

export function listMatchplayEvents(): Promise<MatchplayEvent[]> {
    return listEventsOfFormat(EventFormat.Matchplay)
}

export function getMatchplayEvent(id: string): Promise<MatchplayEvent | undefined> {
    return getEventOfFormat(id, EventFormat.Matchplay)
}

/**
 * Thrown when a write is aimed at a collection the admin only mirrors.
 *
 * A distinct type because the two callers want different things from it: a page
 * shows the message, and a test wants to assert the refusal happened rather than
 * that some string matched.
 */
export class NotOwnedError extends Error {
    constructor(what: string) {
        super(
            `${what} is mirrored, not authored here. Writing it would be reverted by the next ` +
                `\`npm run seed\`. See docs/current/data-ownership.md.`
        )
        this.name = 'NotOwnedError'
    }
}

/**
 * Writes an event of any format the admin owns, and refuses the rest.
 *
 * **The refusal is the point, rather than the generalisation.** This replaced a
 * `saveMatchplayEvent` that took a `MatchplayEvent` and was therefore safe by
 * its type alone; widening it to every format gives that safety up, and this
 * guard is what buys it back — as a rule the store enforces rather than one a
 * document states. What it stops is a page written for one format being pointed
 * at a mirrored one, which is not a hypothetical: every read on this module is
 * now generic, so a page for Hector events is three lines of copying away and
 * the next thing it wants is a save.
 *
 * Firestore would accept that write happily. `npm run seed` would revert it
 * within hours, silently, and the person who made the edit would have no way to
 * tell that from never having pressed the button.
 *
 * Validating through `genericEventSchema` rather than one format's schema is the
 * smaller half, and it is the discriminated union doing the work: it picks the
 * option by `format`, so a Hector event is still checked against the Hector
 * rules. The admin UI is the one writer that could put a malformed event into
 * the store, so it is the one place worth refusing to.
 */
export async function saveEvent(event: Event, updatedBy: string): Promise<void> {
    if (!OWNED_FORMATS.has(event.format)) throw new NotOwnedError(`The ${event.format} format`)

    const validated = genericEventSchema.parse(event)
    const record: StoredDocument = {
        doc: JSON.stringify(validated),
        updatedAt: new Date().toISOString(),
        updatedBy,
    }
    await firestore().collection(EVENTS).doc(validated.id).set(record)
}

/**
 * Removes an event the admin owns, and refuses to remove anything else.
 *
 * The guard is the point, and it used to be a format literal: the admin owned
 * matchplay and only matchplay, so reading the document first and checking it
 * was one made the wrong id a no-op. It now asks `OWNED_FORMATS` the same
 * question, which is the same guard with the list taken out of it.
 *
 * Every mirrored format in this collection is written by a scheduled job, so
 * deleting one here would either be undone on the next tick or, worse, survive
 * until the next export published the hole to the public site.
 *
 * There is no undo in Firestore. There is one in git: the event's committed JSON
 * under `astrosite/src/data/events/` is removed by the next export, as a
 * reviewable commit, so a deletion made in error is recovered by reverting it
 * and seeding. The log line below is the other half of that trail — it is the
 * only provenance a deletion can leave, `updatedBy` having gone with the record.
 *
 * **Returns false rather than throwing, where `saveEvent` throws.** That is
 * deliberate and not an oversight. A save that quietly did nothing is the worst
 * outcome available — the person believes their edit landed — so it is loud. A
 * delete has nothing to lose by being quiet: false already means "not there",
 * the caller says the same thing about an id that is mirrored as about one that
 * does not exist, and the alternative is every call site catching to distinguish
 * two cases it treats identically.
 */
export async function deleteEvent(id: string, deletedBy: string): Promise<boolean> {
    const doc = await firestore().collection(EVENTS).doc(id).get()
    if (!doc.exists) return false
    const event = parse<Event>(genericEventSchema, doc.data(), id)
    if (!event || !OWNED_FORMATS.has(event.format)) return false

    await firestore().collection(EVENTS).doc(id).delete()
    console.log(`Deleted ${event.format} event ${id} ("${event.name}") on behalf of ${deletedBy}`)
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

/**
 * One player, or undefined when the id is not in the store.
 *
 * Reads the document rather than filtering `listPlayers()`, which is forty-six
 * reads to answer a question about one of them. Same parse and the same silence
 * on a schema failure — a player page is a place to find out a document is
 * malformed, but not by rendering half of it.
 */
export async function getPlayer(id: string): Promise<Player | undefined> {
    const doc = await firestore().collection(PLAYERS).doc(id).get()
    if (!doc.exists) return undefined
    return parse<Player>(playerSchema, doc.data(), id)
}

/**
 * Writes a player, once the admin owns them.
 *
 * New: nothing has ever saved a player from here. It exists before its caller
 * does because it is the ownership rule for a collection two scheduled jobs
 * still write — `update-player-biographies` and `update-player-club-memberships`
 * both persist the whole record through `updatePlayerData` — and that rule is
 * cheaper to get right now, with nothing depending on it, than in the middle of
 * building an editor.
 *
 * `PLAYERS_ARE_OWNED` is false today, so this throws for every input. That is
 * the correct behaviour rather than a placeholder: until those two jobs write
 * Firestore instead of files, a player written here is reverted by the next
 * seed. The day the flag flips, this starts working and nothing else about it
 * changes.
 */
export async function savePlayer(player: Player, updatedBy: string): Promise<void> {
    if (!PLAYERS_ARE_OWNED) throw new NotOwnedError('The players collection')

    const validated = playerSchema.parse(player)
    const record: StoredDocument = {
        doc: JSON.stringify(validated),
        updatedAt: new Date().toISOString(),
        updatedBy,
    }
    await firestore().collection(PLAYERS).doc(validated.id).set(record)
}

/**
 * Removes a player, once the admin owns them, and refuses otherwise.
 *
 * False for a player who is not there and for a collection the admin does not
 * own, on the same reasoning as `deleteEvent`.
 *
 * Worth knowing before this ever gets a button: a player id is referenced by
 * `participants` on every event they played, and nothing in this store enforces
 * that. Deleting one leaves those references dangling, which the admin renders
 * as the raw id — `architecture.md` §13 counts twenty ids already in that state
 * for other reasons. Whether a delete should refuse a player with appearances,
 * or warn, is a question for the editor rather than for this function, which is
 * why this one only answers the ownership half.
 */
export async function deletePlayer(id: string, deletedBy: string): Promise<boolean> {
    if (!PLAYERS_ARE_OWNED) return false

    const doc = await firestore().collection(PLAYERS).doc(id).get()
    if (!doc.exists) return false
    const player = parse<Player>(playerSchema, doc.data(), id)
    if (!player) return false

    await firestore().collection(PLAYERS).doc(id).delete()
    console.log(`Deleted player ${id} ("${player.name.first} ${player.name.last}") on behalf of ${deletedBy}`)
    return true
}
