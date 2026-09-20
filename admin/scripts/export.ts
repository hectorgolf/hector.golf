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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'glob'

import { genericEventSchema, type Event } from '@hector/schemas/src/events.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

import { OWNED_FORMATS, PLAYERS_ARE_OWNED, PLAYER_FILES } from '../src/lib/ownership.ts'

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
 * Where each player's committed file is, by id — **discovered, never composed**.
 *
 * Not one of the forty-five files is named after the id it holds:
 * `anders-forss.json` holds `"id": "anders-f"` and `lasse-koskela.json` holds
 * `"id": "lasse-k"`. Events are the opposite — `pathToEventJson` builds
 * `events/{format}/{id}.json` and every file matches — which is why the events
 * side of this script can compose a path and this side cannot.
 *
 * The site already knows this. `playerDataPath()` in `astrosite/src/code/data.ts`
 * globs the directory and matches on the `id` inside each file, and
 * `astrosite/test/unit/player-data-paths.test.ts` exists to pin it: "a player's
 * file is found by matching the `id` *inside* the files, never by building a
 * path out of the id". This is that rule, on the export's side of the fence.
 *
 * Getting it wrong is not a subtle failure. A composed path matches nothing on
 * disk, so `sync` writes forty-five new files under id-shaped names and removes
 * all forty-five real ones as absent from the store — which is what happened the
 * first time this path was written, and is why it is written this way now.
 *
 * A player with no file yet — one created in the admin, which cannot happen
 * until there is an editor — gets the composed name. That is a new file rather
 * than a rename, so it breaks nothing, and it leaves the naming of new players
 * as a decision for whoever builds that editor rather than one made here by
 * accident.
 */
async function playerPathsById(): Promise<Map<string, string>> {
    const byId = new Map<string, string>()

    for (const rel of await glob(PLAYER_FILES, { cwd: dataDir })) {
        const parsed = playerSchema.safeParse(JSON.parse(readFileSync(join(dataDir, rel), 'utf-8')))
        if (parsed.success && parsed.data) byId.set(parsed.data.id, rel)
    }

    return byId
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

    const existing = await playerPathsById()
    const files = new Map(players.map((p) => [existing.get(p.id) ?? `players/${p.id}.json`, p]))
    sync('players', files, [...existing.values()])
}

console.log('Done.')
