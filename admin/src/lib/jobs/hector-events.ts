import { hectorEventSchema, type HectorEvent } from '@hector/schemas/src/events.ts'

/**
 * Reading the committed Hector events, for the jobs that write them back.
 *
 * Two jobs do: the handicaps job redraws an open split, and the leaderboards job
 * writes the pairings it learns from a live board. They read the same 18 files
 * out of git — not out of Firestore, where Hector events are a mirror — for the
 * reason `buckets.ts` gives at length: a scheduled writer against the mirror
 * races an unsynchronised export, which is the conflict
 * `docs/current/data-ownership.md` exists to prevent.
 *
 * Extracted when the second job arrived, rather than exported from the first.
 * What the two share is not a convenience — it is the rule below about a file
 * that does not parse, and a second copy of that rule would be a second place
 * for it to be relaxed by somebody who only had one job in mind.
 */

/** Where the Hector event files live. */
export const EVENTS_PATH = 'astrosite/src/data/events/hector'

/** What reading them needs. A subset of every job's dependencies, named once. */
export type EventReader = {
    /** The files in a directory, as repository-relative paths. Throws if it cannot look. */
    listDirectory(path: string): Promise<string[]>
    /** A file's text, or undefined when it is not there. Throws if the read failed. */
    readFile(path: string): Promise<string | undefined>
}

/** An event as it is committed, kept beside the parsed copy. */
export type StoredEvent = {
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

/**
 * Every committed Hector event, parsed, with the text it was parsed from.
 *
 * A file that does not parse is a hard stop rather than a skip, which is the
 * judgement `admin/scripts/export.ts` already makes about the same documents: a
 * silently dropped event is one whose split simply stops being maintained, or
 * whose leaderboard quietly stops updating, and nothing anywhere says so.
 */
export async function readHectorEvents(reader: EventReader): Promise<StoredEvent[]> {
    const paths = (await reader.listDirectory(EVENTS_PATH)).filter((path) => path.endsWith('.json'))
    const stored: StoredEvent[] = []

    for (const path of paths) {
        const raw = await reader.readFile(path)
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
            throw new Error(`${path} does not match the Hector event schema`)
        }

        stored.push({ path, raw, json: json as Record<string, unknown>, event: parsed.data })
    }

    return stored
}
