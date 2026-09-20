import { bucketingOrder, bucketsToRecompute, splitIntoBuckets } from '@hector/schemas/src/buckets.ts'
import { hectorEventSchema, type HectorEvent } from '@hector/schemas/src/events.ts'
import { getPlayerHandicapFromHistory, type HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import type { Change } from './log.ts'

/**
 * Redrawing the split for every Hector whose buckets are still open.
 *
 * ## Why this is here rather than in Firestore
 *
 * This was the fourth and last output of `update-handicaps.yml`, and the one that
 * kept that workflow alive after the other three moved here. Firestore holds
 * Hector events as a mirror the admin reads, so a scheduled writer there would
 * race an unsynchronised export — the conflict `docs/current/data-ownership.md`
 * exists to prevent.
 *
 * So this writes git instead, which is the same file the workflow writes, from a
 * different process. Git stays the source for Hector events, the mirror stays
 * one-way, and `event.buckets` keeps the owner the ownership table gives it. See
 * `docs/plans/handicaps-to-firestore.md`.
 *
 * ## Why it is part of the handicaps job rather than a job of its own
 *
 * The split is a function of the handicaps that were just read. A separate job
 * would either scrape WiseGolf a second time per tick to have them, or read them
 * back from a store the first job had only just written — and the second is worse
 * than it sounds, because it makes the two jobs' ordering load-bearing with
 * nothing expressing it. One scrape, and the buckets fall out of it.
 */

/** Where the Hector event files live. */
export const EVENTS_PATH = 'astrosite/src/data/events/hector'

export type BucketDependencies = {
    /** The files in a directory, as repository-relative paths. Throws if it cannot look. */
    listDirectory(path: string): Promise<string[]>
    /** A file's text, or undefined when it is not there. Throws if the read failed. */
    readFile(path: string): Promise<string | undefined>
    replace(
        path: string,
        text: string,
        message: string
    ): Promise<{ ok: true; commit: string } | { ok: false; detail: string }>
}

export type BucketResult = {
    outcome: 'ok' | 'failed'
    detail?: string
    changes: Change[]
    /**
     * The event files this run committed.
     *
     * Reported because they are the only thing the job writes *inside*
     * `astrosite/`, and that decides whether it has to ask for a deploy or
     * whether the push has already started one. See `publish()` in `execute.ts`.
     */
    committed: string[]
}

/** An event as it is committed, kept beside the parsed copy. See `splitFor`. */
type StoredEvent = {
    path: string
    /** The file's text, to compare a render against. */
    raw: string
    /**
     * The file's JSON, which is what gets written back.
     *
     * Deliberately not the Zod output. `hectorEventSchema` defaults `ignore` to
     * `false`, so writing the parsed copy would materialise that field into every
     * event that does not carry it — the same objection `data-ownership.md` makes
     * to giving `bucketsLocked` a default, and it would arrive as a diff on files
     * this run had no business touching.
     */
    json: Record<string, unknown>
    event: HectorEvent
}

/** The name the sort's last tiebreak orders on. */
const nameOf = (player: Player): string => `${player.name.first} ${player.name.last}`

/** A bucket entry, as the event file stores one. */
type Seat = { id: string; handicap: number }

/**
 * The split an event would have, given today's handicaps.
 *
 * The handicap stored in a seat and the handicap the sort orders on are not the
 * same expression, and that is inherited rather than invented: the sort asks the
 * observation log only, while the stored value falls back to `player.handicap`
 * for somebody the log has never heard of. A player in that state therefore
 * sorts as scratch and is stored with their stopgap. Changing it is a change to
 * committed splits and belongs in its own commit.
 */
function splitFor(participants: readonly Player[], history: readonly HandicapHistoryEntry[]): [Seat[], Seat[]] {
    const sorted = [...participants].sort(bucketingOrder([...history], nameOf))
    return splitIntoBuckets(
        sorted.map((player) => ({
            id: player.id,
            handicap: getPlayerHandicapFromHistory(player.id, [...history]) ?? player.handicap ?? 0,
        }))
    )
}

/** Which half a player is in, for the run log. `undefined` when they were in neither. */
function halfOf(buckets: ReadonlyArray<ReadonlyArray<{ id: string }>> | undefined, id: string): string | undefined {
    if (!buckets) return undefined
    const index = buckets.findIndex((bucket) => bucket.some((seat) => seat.id === id))
    return index === -1 ? undefined : `bucket ${index + 1}`
}

/**
 * What changed about a split, in terms somebody reading the run log can act on.
 *
 * A player crossing between halves is the thing that matters — it is what the
 * Draft after round one reads. A re-ordering *within* the halves still changes
 * the file, and is reported as one line rather than as twenty: the order inside a
 * bucket is not something anybody plays off, and listing every seat would bury
 * the crossings it is mixed in with.
 */
export function bucketChanges(
    event: Pick<HectorEvent, 'id' | 'buckets'>,
    next: readonly [readonly Seat[], readonly Seat[]]
): Change[] {
    const crossings: Change[] = []
    for (const [index, bucket] of next.entries()) {
        for (const seat of bucket) {
            const before = halfOf(event.buckets, seat.id)
            const after = `bucket ${index + 1}`
            if (before !== after) crossings.push({ subject: seat.id, from: before, to: after })
        }
    }
    if (crossings.length > 0) return crossings
    return [{ subject: event.id, from: 'the same halves', to: 'a new order within them' }]
}

/**
 * Recompute every open split, and commit the ones that moved.
 *
 * `history` is the log *including* what this run just read, which is what makes
 * the buckets reflect this morning's handicaps rather than yesterday's. The
 * workflow this replaces achieves the same thing by re-reading `handicaps.json`
 * after writing it.
 *
 * A failure is per event rather than fatal to the sweep: the events are
 * independent, and one unparseable file is no reason to leave the other twelve
 * splits stale. The run still reports `failed`, naming which ones.
 */
export async function recompute(
    dependencies: BucketDependencies,
    players: readonly Player[],
    history: readonly HandicapHistoryEntry[],
    now: Date,
    dryRun: boolean
): Promise<BucketResult> {
    const stored = await read(dependencies)
    const { recompute: open, locked } = bucketsToRecompute(
        stored.map((entry) => entry.event),
        now
    )

    for (const event of locked) {
        // Said out loud, because a lock that stops a recompute silently is a
        // suspected bug the first time somebody wonders why the buckets did not
        // move. The workflow says the same thing for the same reason.
        console.log(
            `Leaving the buckets for ${event.name} alone: bucketsLocked is set, so this split is settled ` +
                `even though it would otherwise still be open.`
        )
    }

    const byId = new Map(players.map((player) => [player.id, player]))
    const changes: Change[] = []
    const committed: string[] = []
    const failures: string[] = []

    for (const event of open) {
        const entry = stored.find((candidate) => candidate.event.id === event.id)!

        /*
         * A participant nobody knows about stops this event, rather than being
         * dropped from the split.
         *
         * The workflow filters these out silently, which was survivable while it
         * read the player files out of the same checkout as the events. This
         * reads players from Firestore's mirror, where a document that failed to
         * sync is a reachable state — and a split quietly missing a player is
         * both wrong and invisible, since the file still looks like a valid
         * split of whoever is in it.
         */
        const missing = event.participants.filter((id) => !byId.has(id))
        if (missing.length > 0) {
            console.error('Refusing to redraw a split for an event with participants nobody knows about', {
                event: event.id,
                missing,
            })
            failures.push(`${event.id} has ${missing.length} participant(s) with no player record: ${missing.join(', ')}`)
            continue
        }

        const next = splitFor(
            event.participants.map((id) => byId.get(id)!),
            history
        )

        const rendered = serializeJson({ ...entry.json, buckets: next })
        if (rendered === entry.raw) continue

        changes.push(...bucketChanges(event, next))

        if (dryRun) {
            // The whole output of a shadow recompute: what it worked out, in the
            // run log and in Cloud Logging, having written nothing. Serialised
            // onto one line for the same reason the handicap shadow run is —
            // Cloud Run's logging agent makes a separate entry per line, so a
            // pretty-printed split arrives shredded.
            console.log(
                `Shadow recompute: ${event.id} would be rewritten: ${JSON.stringify(
                    next.map((bucket) => bucket.map((seat) => seat.id))
                )}`
            )
            continue
        }

        const written = await dependencies.replace(entry.path, rendered, `Update the buckets for ${event.name}`)
        if (!written.ok) {
            failures.push(written.detail)
            continue
        }
        // `unchanged` is a no-op the commit helper reports rather than a write,
        // and counting it would ask for a deploy that has nothing to publish.
        if (written.commit !== 'unchanged') committed.push(entry.path)
    }

    if (failures.length > 0) {
        return { outcome: 'failed', detail: failures.join('; '), changes, committed }
    }
    return { outcome: 'ok', changes, committed }
}

/**
 * Every committed Hector event, parsed, with the text it was parsed from.
 *
 * A file that does not parse is a hard stop rather than a skip, which is the
 * judgement `admin/scripts/export.ts` already makes about the same documents: a
 * silently dropped event is one whose split simply stops being maintained, and
 * nothing anywhere says so.
 */
async function read(dependencies: BucketDependencies): Promise<StoredEvent[]> {
    const paths = (await dependencies.listDirectory(EVENTS_PATH)).filter((path) => path.endsWith('.json'))
    const stored: StoredEvent[] = []

    for (const path of paths) {
        const raw = await dependencies.readFile(path)
        if (raw === undefined) {
            // Listed a moment ago and gone now. Not a skip: it means something is
            // rewriting this directory while the sweep reads it.
            throw new Error(`${path} was listed but could not be read`)
        }

        let json: unknown
        try {
            json = JSON.parse(raw)
        } catch (error) {
            throw new Error(`${path} is not valid JSON: ${String(error)}`)
        }

        const parsed = hectorEventSchema.safeParse(json)
        if (!parsed.success) {
            throw new Error(`${path} does not match the Hector event schema; refusing to redraw any split`)
        }

        stored.push({ path, raw, json: json as Record<string, unknown>, event: parsed.data })
    }

    return stored
}
