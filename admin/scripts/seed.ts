/**
 * Refresh Firestore's copy of the data the admin only mirrors.
 *
 * Deliberately NOT matchplay. That is the one thing the admin authors, so
 * Firestore is its source of truth and the committed files are generated from it
 * — writing those files back over Firestore would revert any tournament edit
 * that has not been exported yet, silently and completely. The export was
 * narrowed to owned data for the mirror image of this reason; this is the other
 * half of that pair, and `src/lib/ownership.ts` holds the one list they share.
 *
 * The trap worth naming: this is the script you reach for legitimately. Nothing
 * refreshes the mirror on its own, so after a scrape the admin's roster shows
 * stale handicaps and the fix is to run this. Before `--bootstrap` existed as a
 * separate thing, that repair also ate your tournament.
 *
 * `--bootstrap` additionally imports the owned formats, for standing up a new
 * project where Firestore has nothing yet. It refuses if anything it would
 * overwrite was last written by someone other than this script.
 *
 * Validates every record through the same schema the admin writes with, so a
 * file that would not survive a round trip fails here rather than at render
 * time.
 *
 *   npm run seed                 # refresh the mirror
 *   npm run seed -- --bootstrap  # also import matchplay, for a new project
 *   FIRESTORE_EMULATOR_HOST=localhost:8432 npm run seed -- --bootstrap
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'glob'

import { genericEventSchema } from '@hector/schemas/src/events.ts'
import { schema as playerSchema } from '@hector/schemas/src/players.ts'

import { ALL_FORMATS, MIRRORED_FORMATS, OWNED_FORMATS } from '../src/lib/ownership.ts'
import { firestore, reportingStoreErrors, target } from './store.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../../astrosite/src/data')


async function seed(
    label: string,
    collection: string,
    pattern: string,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: { id: string }; error?: unknown } }
): Promise<void> {
    const files = await glob(pattern, { cwd: dataDir, absolute: true })
    let written = 0
    let unchanged = 0
    let skipped = 0

    for (const file of files) {
        const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
        if (!parsed.success || !parsed.data) {
            console.error(`  SKIP ${file.replace(dataDir, '')}: does not match the schema`)
            skipped += 1
            continue
        }

        const doc = JSON.stringify(parsed.data)
        const ref = firestore.collection(collection).doc(parsed.data.id)

        // Read before writing, so a document that has not changed is left alone.
        // This runs twice a day on a schedule: writing all sixty every time would
        // burn the free tier's write quota on nothing, and — worse — make
        // `updatedAt` mean "when the seed last ran" rather than "when this last
        // changed", which is the field the ownership rules will lean on.
        const existing = (await ref.get()).data() as { doc?: string } | undefined
        if (existing?.doc === doc) {
            unchanged += 1
            continue
        }

        await ref.set({ doc, updatedAt: new Date().toISOString(), updatedBy: 'seed' })
        written += 1
    }

    const parts = [`${written} written`]
    if (unchanged) parts.push(`${unchanged} unchanged`)
    if (skipped) parts.push(`${skipped} skipped`)
    console.log(`  ${label}: ${parts.join(', ')}`)
}

const bootstrap = process.argv.includes('--bootstrap')
const formats = bootstrap ? ALL_FORMATS : MIRRORED_FORMATS

/**
 * A document whose last writer was not this script came from the admin UI, and
 * Firestore is the only place it exists. Overwriting it with the committed file
 * would not be an import, it would be a revert.
 */
async function refuseToOverwriteAuthoredEvents(): Promise<void> {
    const snapshot = await firestore.collection('events').get()
    const authored: string[] = []

    for (const doc of snapshot.docs) {
        const stored = doc.data() as { doc?: string; updatedBy?: string }
        if (!stored.doc || stored.updatedBy === 'seed') continue
        const parsed = genericEventSchema.safeParse(JSON.parse(stored.doc))
        if (parsed.success && parsed.data && OWNED_FORMATS.has(parsed.data.format)) {
            authored.push(`${doc.id} (last written by ${stored.updatedBy ?? 'unknown'})`)
        }
    }

    if (authored.length > 0) {
        throw new Error(
            `Refusing to --bootstrap over events the admin has edited:\n` +
                authored.map((a) => `  ${a}`).join('\n') +
                `\n\nFirestore is the only copy of those. Export them first ` +
                `(npm run export), or drop them by hand if you really mean to.`
        )
    }
}

console.log(`Seeding ${target}…`)
console.log(bootstrap ? '  --bootstrap: importing owned formats too' : `  mirror only; ${[...OWNED_FORMATS].join(', ')} is authored in the admin`)

await reportingStoreErrors(async () => {
    if (bootstrap) await refuseToOverwriteAuthoredEvents()
    for (const format of formats) {
        await seed(format, 'events', `events/${format}/*.json`, genericEventSchema)
    }
    await seed('players', 'players', 'players/*.json', playerSchema)
})
console.log('Done.')
