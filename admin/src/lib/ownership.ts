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
 * for the UI, never a source. See docs/current/data-ownership.md.
 */
export const OWNED_FORMATS: ReadonlySet<EventFormat> = new Set([EventFormat.Matchplay])

/** The complement, derived rather than restated. */
export const MIRRORED_FORMATS: readonly EventFormat[] = Object.values(EventFormat).filter(
    (format) => !OWNED_FORMATS.has(format)
)

/** What the seed writes when told to import everything, ordered mirrors-first. */
export const ALL_FORMATS: readonly EventFormat[] = [...MIRRORED_FORMATS, ...OWNED_FORMATS]

/**
 * Whether the admin authors players, as `OWNED_FORMATS` says which event formats
 * it authors.
 *
 * A boolean and not a set, because there is one player collection and no
 * sub-kinds to own separately. It reads oddly beside the set above and that is
 * the honest shape: the events side has three formats and two columns, the
 * players side has one collection and a yes or no.
 *
 * ## What flipping this does, and what it does not
 *
 * Every mechanism that enforces ownership now reads it — `savePlayer` and
 * `deletePlayer` refuse while it is false, `export.ts` publishes players only
 * while it is true, and `seed.ts` both stops overwriting them and starts
 * refusing to `--bootstrap` over an authored one. That is the whole of what step
 * 0 of `docs/plans/authoring-players-and-events.md` can do for players, and it
 * means the flip is one edit rather than five places somebody has to find.
 *
 * It was emphatically **not** the whole of the flip while
 * `update-player-biographies` and `update-player-club-memberships` still wrote
 * the committed files from GitHub Actions. Flipping this with those in place
 * would have recreated the loop in the other direction: the admin publishes a
 * player, the next scrape commits over it, and the export publishes the mirror
 * back. `data-ownership.md` states the rule — a collection moves on the day the
 * admin can author it *and* its scheduled writer has moved, and either one alone
 * is worse than neither.
 *
 * ## Flipped 2026-09-21, with both halves done
 *
 * Both jobs run in this service and write Firestore; both workflows are deleted;
 * and the admin has an editor for the four fields a person writes. The day was
 * boring because the guards were built first, which is what step 0 was for.
 *
 * One thing that was *not* boring, and is worth knowing if this is ever done for
 * another collection: the mirror was stale. Two players had been corrected by
 * hand in the files on 2026-09-20 (`6ca4e486`, `KJKG` to `Koto`) and
 * `refresh-admin-mirror.yml` never saw it — it fires on the scrapes finishing
 * and on pushes under `events/hector/`, neither of which a hand-edited player
 * file is. Flipping without refreshing would have published Firestore's stale
 * `KJKG` back over the correction, silently, as the very first export.
 *
 * The check that caught it is the one `docs/plans/authoring-players-and-events.md`
 * names, run against *production* rather than an emulator: export with the flag
 * flipped locally, `git diff`, expect nothing. Do that before the next flip too.
 */
export const PLAYERS_ARE_OWNED = true

/**
 * Where the committed player files are, relative to `astrosite/src/data/`.
 *
 * One glob, imported by the export and the seed, for the same reason
 * `OWNED_FORMATS` is one set: the two scripts move data in opposite directions
 * over the same files, and a pattern that drifted between them would be a
 * silently half-covered collection.
 *
 * It matches files and not directories, which matters here — `players/images/`
 * sits beside them and holds forty photographs nothing reads.
 */
export const PLAYER_FILES = 'players/*.json'
