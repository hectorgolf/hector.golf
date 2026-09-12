import { EventFormat } from '@hector/schemas/src/events.ts'

/**
 * Which data the admin authors, and which it only mirrors.
 *
 * One list, imported by both scripts, because they are supposed to be exact
 * complements and separately-maintained lists are how they stopped being that.
 * The export publishes Firestore over the committed files; the seed writes the
 * committed files over Firestore. Pointed at the same collection they are a loop
 * that destroys whichever edit is younger, and it is silent in both directions.
 *
 * `OWNED` is what the admin can author, so Firestore is its source of truth and
 * the committed JSON is generated from it. Everything else is a mirror the admin
 * reads — scheduled jobs write those files, and Firestore's copy is a convenience
 * for the UI, never a source. See docs/data-ownership.md.
 */
export const OWNED_FORMATS: ReadonlySet<EventFormat> = new Set([EventFormat.Matchplay])

/** The complement, derived rather than restated. */
export const MIRRORED_FORMATS: readonly EventFormat[] = Object.values(EventFormat).filter(
    (format) => !OWNED_FORMATS.has(format)
)

/** What the seed writes when told to import everything, ordered mirrors-first. */
export const ALL_FORMATS: readonly EventFormat[] = [...MIRRORED_FORMATS, ...OWNED_FORMATS]
