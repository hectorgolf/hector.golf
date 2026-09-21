/**
 * Write Firestore back out to the committed JSON the site builds from.
 *
 * This is the half of the migration that keeps the public site unchanged. After
 * the one-off import, Firestore is where the admin's data is authored and the
 * matching files under `astrosite/src/data/` are *generated* — same files, same
 * build, but
 * output rather than input. Two things fall out of that which are worth having:
 * the site build stays hermetic, needing no credentials and working on a fork;
 * and git keeps a reviewable history of every change the admin UI made, so the
 * fix for a bad edit is a revert.
 *
 * Nothing stops a person editing those files by hand and losing the edit at the
 * next export. That was a deliberate choice for a one-developer repository — see
 * docs/current/data-ownership.md — rather than something nobody thought of.
 *
 * It exports only what the admin can author, which today is matchplay events and
 * nothing else. Firestore holds players and the other event formats too, but as
 * a mirror the admin reads, not as their source: three scheduled jobs write
 * player files and two write Hector events, on every tick in the handicaps case.
 * Exporting those would publish a stale mirror over a fresh scrape and revert it
 * silently — the scrape's own commit would look like the losing side of a merge
 * nobody performed. A collection joins this list on the day the admin can author
 * it and its scheduled writer moves to Firestore, not before.
 *
 *   npm run export                                  # the real database
 *   FIRESTORE_EMULATOR_HOST=localhost:8432 npm run export
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'glob'

import { genericEventSchema, type Event } from '@hector/schemas/src/events.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import {
    schema as courseSchema,
    referencedObjects,
    uploadedImagePath,
    withPublishedImages,
    withoutTeeIds,
    type Course,
} from '@hector/schemas/src/courses.ts'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

import {
    COURSES_ARE_OWNED,
    COURSE_FILES,
    OWNED_FORMATS,
    PLAYERS_ARE_OWNED,
    PLAYER_FILES,
} from '../src/lib/ownership.ts'

import { getAsset } from '../src/lib/assets.ts'
import { firestore, reportingStoreErrors, target } from './store.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../../astrosite/src/data')


/**
 * Reads a collection and validates every document on the way out.
 *
 * A document that fails is a hard stop rather than a skip: a partial export
 * silently drops an event from the public site, which is worse than not
 * exporting at all and much harder to notice.
 */
async function read<T>(
    collection: string,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }
): Promise<T[]> {
    const snapshot = await firestore.collection(collection).get()
    const out: T[] = []

    for (const doc of snapshot.docs) {
        const stored = doc.data() as { doc?: string }
        if (!stored?.doc) throw new Error(`${collection}/${doc.id} has no document body`)
        const parsed = schema.safeParse(JSON.parse(stored.doc))
        if (!parsed.success || !parsed.data) {
            throw new Error(`${collection}/${doc.id} does not match its schema; refusing to export a partial set`)
        }
        out.push(parsed.data)
    }

    return out
}

/** An event's file is composed from its format and id, as `pathToEventJson` does. */
const eventPath = (event: Event): string => `events/${event.format}/${event.id}.json`

/**
 * A player's file is composed from their id, as an event's is from format and id.
 *
 * It was discovered rather than composed until 2026-09-20, by globbing the
 * directory and matching on the `id` inside each file, because not one of the
 * forty-five files was named after the id it held: `anders-forss.json` held
 * `"id": "anders-f"`. Composing a path then matched nothing on disk, so `sync`
 * wrote forty-five new files under id-shaped names and removed all forty-five
 * real ones as absent from the store — which is exactly what happened the first
 * time this was written.
 *
 * The files are named after their ids now, so the discovery has nothing left to
 * discover. What keeps that true is `astrosite/test/unit/player-data-paths.test.ts`,
 * which used to forbid this line and now requires it: every committed player
 * file is named after the id it holds, or that test fails before this can lose
 * anything.
 */
const playerPath = (player: Player): string => `players/${player.id}.json`

/** Where the site serves images from, as opposed to where it reads data. */
const publicDir = join(here, '../../astrosite/public')

/** The one directory the export owns inside a course's images. */
const uploadedDir = (courseId: string) => join(publicDir, 'images/courses', courseId, 'uploaded')

/**
 * Brings every image a course references out of the bucket and into the
 * repository, and takes away the ones it no longer references.
 *
 * ## Why the pruning is scoped to one directory
 *
 * The obvious rule is "delete images git holds that no document references",
 * and it is wrong here — measurably. `astrosite/public/images/courses/` holds
 * 326 files against 300 referenced paths, and of the 26 nobody names, 18 are
 * `lafinca/holes/*.svg`: hole-layout diagrams for the one course whose hole
 * descriptions have not been written yet. That rule would throw away work
 * somebody did in advance.
 *
 * So the export owns exactly one directory per course — `uploaded/` — creates
 * it, writes only objects the document references into it, and deletes only
 * files in it. Everything else under `images/courses/` belongs to whoever put
 * it there. See `docs/plans/courses-in-the-admin.md`, step 5.
 *
 * ## Why the names are stable
 *
 * An object is named after a digest of its own bytes, so the same picture
 * produces the same filename every time and an unchanged image is not a diff.
 * A random id per upload would rewrite a file in git whenever somebody re-picked
 * the same photograph.
 */
async function publishUploadedImages(courses: readonly Course[]): Promise<void> {
    let written = 0
    let removed = 0

    for (const course of courses) {
        const wanted = new Map(
            referencedObjects(course).map((object) => [uploadedImagePath(course.id, object).split('/').pop()!, object])
        )
        const directory = uploadedDir(course.id)

        if (wanted.size === 0 && !existsSync(directory)) continue
        mkdirSync(directory, { recursive: true })

        for (const [filename, object] of wanted) {
            const path = join(directory, filename)
            // Named after a digest of its contents, so a file that is already
            // there is already correct and downloading it again would cost a
            // request to prove it.
            if (existsSync(path)) continue
            writeFileSync(path, await getAsset(object))
            written += 1
        }

        for (const filename of readdirSync(directory)) {
            if (wanted.has(filename)) continue
            rmSync(join(directory, filename))
            removed += 1
        }
    }

    if (written || removed) {
        console.log(`  course images: ${written} written, ${removed} removed`)
    }
}

/**
 * Refuses to publish an empty set over a directory that is not empty.
 *
 * Both callers read a collection and then delete every committed file the read
 * did not account for, so an empty read is indistinguishable from "delete them
 * all" — a very fast way to lose them to a misconfigured database id or a failed
 * import. The events version of this guard was written first and inline; it is a
 * function now because players need exactly the same one, over forty-five files
 * rather than three.
 */
function refuseEmpty(label: string, count: number, what: string): void {
    if (count > 0) return
    throw new Error(`The store holds no ${label}. Refusing to export, which would delete ${what}.`)
}

/**
 * Writes the set, and removes committed files the store no longer has.
 *
 * Without the removal an event deleted in the admin would live on in the site
 * forever, which is the "deletion is inexpressible" failure that ruled out
 * reading from both places in the first place.
 */
function sync(label: string, files: Map<string, unknown>, existing: string[]): void {
    let changed = 0

    for (const [rel, value] of files) {
        const full = join(dataDir, rel)
        mkdirSync(dirname(full), { recursive: true })
        const next = serializeJson(value)
        const before = existing.includes(rel) ? readFileSync(full, 'utf-8') : undefined
        if (before !== next) {
            writeFileSync(full, next)
            changed += 1
        }
    }

    const removed = existing.filter((rel) => !files.has(rel))
    for (const rel of removed) rmSync(join(dataDir, rel))

    console.log(`  ${label}: ${files.size} exported, ${changed} changed, ${removed.length} removed`)
    for (const rel of removed) console.log(`    removed ${rel}`)
}

console.log(`Exporting from ${target}…`)

const events = await reportingStoreErrors(() => read<Event>('events', genericEventSchema))

// The formats the admin can author. Everything else in the store is a mirror it
// reads and must not publish over whoever does own it. The seed reads the same
// list from the other side, so the two cannot start overlapping.
const OWNED = OWNED_FORMATS
const owned = events.filter((e) => OWNED.has(e.format))

refuseEmpty(`events of ${[...OWNED].join(', ')}`, owned.length, 'their committed files')

// One glob per owned format, never `events/**`: a wider glob would treat every
// Hector and Finnkampen file as missing from the store and delete it.
for (const format of OWNED) {
    const mine = owned.filter((e) => e.format === format)
    sync(format, new Map(mine.map((e) => [eventPath(e), e])), await glob(`events/${format}/*.json`, { cwd: dataDir }))
}

/*
 * Players, once the admin owns them — and not before.
 *
 * Gated rather than absent, which is the whole of what step 0 of
 * `docs/plans/authoring-players-and-events.md` can do here. `PLAYERS_ARE_OWNED`
 * is false, so this block does not run and the export behaves exactly as it did;
 * the day it flips, the path is already written, already guarded, and already
 * round-trip tested.
 *
 * That last part is why this is worth having before its caller. The plan names
 * one acceptance test — seed a clean emulator, export, `git diff --exit-code` —
 * and says to settle any difference as its own commit *before* the flip rather
 * than inside it. Without this block there is nothing to run that test against,
 * so the first person to own players would be discovering schema defaults and
 * key order in the same change that moves two scheduled jobs.
 */
if (PLAYERS_ARE_OWNED) {
    const players = await reportingStoreErrors(() => read<Player>('players', playerSchema))
    refuseEmpty('players', players.length, 'every committed player file')

    const files = new Map(players.map((player) => [playerPath(player), player]))
    sync('players', files, await glob(PLAYER_FILES, { cwd: dataDir }))
}

/*
 * Courses, once the admin owns them — and not before.
 *
 * Gated the way the players block is, and here before its caller for the same
 * reason: the plan's acceptance test is seed, export, `git diff --exit-code`, and
 * without this there is nothing to run it against. The first person to own
 * courses should not be discovering schema defaults, key order *and* the tee-id
 * round trip in the change that flips the flag.
 *
 * `withoutTeeIds` is what makes this not a straight dump of the store. A tee's
 * `id` exists so a rename can rekey the scorecard, and it has no business in a
 * file people open by hand — see `docs/plans/courses-in-the-admin.md` for why
 * that makes seed and export deliberately *not* strict complements here.
 */
if (COURSES_ARE_OWNED) {
    const courses = await reportingStoreErrors(() => read<Course>('courses', courseSchema))
    refuseEmpty('courses', courses.length, 'every committed course file')

    await publishUploadedImages(courses)

    const files = new Map(
        courses.map((course) => [`courses/${course.id}.json`, withoutTeeIds(withPublishedImages(course))])
    )
    sync('courses', files, await glob(COURSE_FILES, { cwd: dataDir }))
}

console.log('Done.')
