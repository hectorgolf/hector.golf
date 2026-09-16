import { schema as courseSchema } from '@hector/schemas/src/courses.ts'
import { genericEventSchema } from '@hector/schemas/src/events.ts'
import { schema as handicapCheckSchema } from '@hector/schemas/src/handicap-checks.ts'
import { schema as handicapSchema } from '@hector/schemas/src/handicaps.ts'
import { schema as playerSchema } from '@hector/schemas/src/players.ts'
import { z } from 'zod'

/**
 * Every collection the site is built from, described once.
 *
 * ## Why one list
 *
 * Three things need to agree about what the data is: the migration that puts it
 * into Firestore, the endpoint that serves it back, and the site that reads it.
 * They agreed by accident before, because all three were looking at the same
 * directory of files. Once the files are gone, the only thing keeping them in
 * step is this list — so it holds the schema, the id rule and the shape, and the
 * three consumers derive everything from it rather than restating it.
 *
 * Adding a collection is an entry here and nothing else.
 *
 * ## The two shapes
 *
 * `documents` means one Firestore document per record, keyed by the record's own
 * id: players, events, courses, leaderboards. That is the shape that supports an
 * editor, which is the point of the whole exercise — a UI that saves one course
 * writes one document.
 *
 * `log` means an append-only list that is not per-entity: the handicap
 * observations and the sweep log. These are stored as one document per entry
 * with a derived id, because they have no natural key and are never edited, only
 * added to.
 *
 * `clubs` is the odd one out and is deliberately `log`-shaped rather than
 * `documents`-shaped: it is a lookup table regenerated wholesale by
 * `update-player-biographies`, not a set of entities anybody edits. Giving it
 * per-club documents would imply an editor that should not exist.
 */

export type CollectionShape = 'documents' | 'log'

export type CollectionSpec = {
    /** The Firestore collection, and the key in the snapshot payload. */
    name: string
    /** Where the records come from, relative to `astrosite/src/data/`. */
    source: string
    shape: CollectionShape
    /** Validated on the way in and on the way out, with the same schema. */
    schema: z.ZodTypeAny
    /**
     * The document id for a record.
     *
     * Returned rather than assumed, because only half of these have an `id`
     * field. A stable, derived id is what makes the migration idempotent: run it
     * twice and the second run overwrites the same documents rather than
     * doubling the collection.
     */
    id: (record: any, index: number) => string
    /**
     * Whether the source file is one JSON array rather than a directory of files.
     *
     * `handicaps.json`, `handicap-checks.json` and `clubs.json` are each a single
     * array; the rest are a file per record.
     */
    singleFile: boolean
}

/** The clubs lookup has no schema of its own anywhere else, so it is defined here. */
const clubSchema = z.object({
    name: z.string(),
    abbreviation: z.string(),
    sources: z.array(z.object({ name: z.string(), id: z.string() })),
})

/**
 * A leaderboard, as `update-leaderboards` writes it.
 *
 * Loose on purpose: the `hector` and `victor` payloads come from Google Sheets
 * and app.hector.golf and their shape is decided there, not here. Validating
 * them strictly would mean this list has to be updated whenever a third party
 * adds a column — and the site already treats them as opaque until
 * `enrichLeaderboard` gets hold of them.
 */
const leaderboardSchema = z
    .object({
        event: z.string(),
        updatedAt: z.string().optional(),
    })
    .passthrough()

export const COLLECTIONS: readonly CollectionSpec[] = [
    {
        name: 'players',
        source: 'players/**/*.json',
        shape: 'documents',
        schema: playerSchema,
        id: (record) => record.id,
        singleFile: false,
    },
    {
        name: 'events',
        source: 'events/**/*.json',
        shape: 'documents',
        schema: genericEventSchema,
        id: (record) => record.id,
        singleFile: false,
    },
    {
        name: 'courses',
        source: 'courses/**/*.json',
        shape: 'documents',
        schema: courseSchema,
        id: (record) => record.id,
        singleFile: false,
    },
    {
        name: 'leaderboards',
        source: 'leaderboards/*.json',
        shape: 'documents',
        schema: leaderboardSchema,
        id: (record) => record.event,
        singleFile: false,
    },
    {
        name: 'clubs',
        source: 'clubs.json',
        shape: 'log',
        schema: clubSchema,
        // Keyed by abbreviation, which is what the scrapes look a club up by.
        // Not the name: two clubs share a name in WiseGolf's list often enough
        // that it is not a key, and the abbreviation is what `resolveClubNumber`
        // matches on anyway.
        id: (record) => record.abbreviation,
        singleFile: true,
    },
    {
        name: 'handicap-observations',
        source: 'handicaps.json',
        shape: 'log',
        schema: handicapSchema,
        // The same derivation as the incremental plan uses, and for the same
        // reason: entries carry no id, and a generated one would make the
        // migration insert 1,406 duplicates every time it ran.
        id: (record) => `${record.player}_${record.date}_${record.observed ?? 'unstamped'}`,
        singleFile: true,
    },
    {
        name: 'handicap-checks',
        source: 'handicap-checks.json',
        shape: 'log',
        schema: handicapCheckSchema,
        // `at` is the sweep's instant and there is exactly one sweep per run, so
        // it is unique by construction — and unlike an index, it stays stable if
        // a sweep is ever added out of order.
        id: (record) => record.at,
        singleFile: true,
    },
]

export function collectionByName(name: string | undefined): CollectionSpec | undefined {
    return COLLECTIONS.find((collection) => collection.name === name)
}

/**
 * The key each collection has in the snapshot payload.
 *
 * camelCase in the payload and kebab-case in Firestore, which is the convention
 * each side already uses. Derived rather than listed, so the two cannot drift.
 */
export const snapshotKey = (collection: CollectionSpec): string =>
    collection.name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
