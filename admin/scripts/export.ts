/**
 * Write Firestore back out to the committed JSON the site builds from.
 *
 * This is the half of the migration that keeps the public site unchanged. After
 * the one-off import, Firestore is where events and players are authored and
 * `astrosite/src/data/**` is *generated* — the same files, the same build, but
 * output rather than input. Two things fall out of that which are worth having:
 * the site build stays hermetic, needing no credentials and working on a fork;
 * and git keeps a reviewable history of every change the admin UI made, so the
 * fix for a bad edit is a revert.
 *
 * Nothing stops a person editing those files by hand and losing the edit at the
 * next export. That was a deliberate choice for a one-developer repository — see
 * docs/data-ownership.md — rather than something nobody thought of.
 *
 *   npm run export                                  # the real database
 *   FIRESTORE_EMULATOR_HOST=localhost:8432 npm run export
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Firestore } from '@google-cloud/firestore'
import { glob } from 'glob'

import { genericEventSchema, type Event } from '@hector/schemas/src/events.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import { schema as playerSchema, type Player } from '@hector/schemas/src/players.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../../astrosite/src/data')

const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'hector-golf',
    databaseId: process.env.FIRESTORE_DATABASE_ID ?? '(default)',
})

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
 * Where each player id already lives, found by reading the files rather than by
 * composing a path out of the id.
 *
 * Not one player file is named after the id it holds — `anders-forss.json` holds
 * `"id": "anders-f"` — so composing `players/${id}.json` writes a second file
 * for a player who already has one. Nothing fails at that moment: the site globs
 * the directory, so it simply loads the player twice under one id.
 * `playerDataPath` in the site takes the same approach for the same reason, and
 * `astrosite/test/unit/player-data-paths.test.ts` pins it.
 */
async function existingPlayerPaths(): Promise<Map<string, string>> {
    const byId = new Map<string, string>()
    for (const rel of await glob('players/**/*.json', { cwd: dataDir })) {
        const parsed = playerSchema.safeParse(JSON.parse(readFileSync(join(dataDir, rel), 'utf-8')))
        if (parsed.success && parsed.data) byId.set(parsed.data.id, rel)
    }
    return byId
}

/** Only ever used for a player the repository has no file for yet. */
function newPlayerPath(player: Player): string {
    const slug = (part: string) =>
        part
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
    return `players/${slug(player.name.first)}-${slug(player.name.last)}.json`
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

console.log(`Exporting from ${process.env.FIRESTORE_EMULATOR_HOST ?? 'the real database'}…`)

const events = await read<Event>('events', genericEventSchema)
const players = await read<Player>('players', playerSchema)

if (events.length === 0 && players.length === 0) {
    // An empty store would otherwise delete every committed data file, which is
    // a very fast way to lose the site to a misconfigured database id.
    throw new Error('The store is empty. Refusing to export, which would delete every committed data file.')
}

const knownPaths = await existingPlayerPaths()

sync('events', new Map(events.map((e) => [eventPath(e), e])), await glob('events/**/*.json', { cwd: dataDir }))
sync(
    'players',
    new Map(players.map((p) => [knownPaths.get(p.id) ?? newPlayerPath(p), p])),
    await glob('players/**/*.json', { cwd: dataDir })
)
console.log('Done.')
