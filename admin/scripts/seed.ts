/**
 * Load the committed JSON into Firestore.
 *
 * Used to seed the emulator for local work, and to do the one-off import into
 * the real database. Validates every record through the same schema the admin
 * writes with, so a file that would not survive a round trip fails here rather
 * than at render time.
 *
 *   npm run seed                                    # the real database
 *   FIRESTORE_EMULATOR_HOST=localhost:8432 npm run seed
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'glob'

import { genericEventSchema } from '@hector/schemas/src/events.ts'
import { schema as playerSchema } from '@hector/schemas/src/players.ts'
import { firestore, reportingStoreErrors, target } from './store.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../../astrosite/src/data')


async function seed(
    collection: string,
    pattern: string,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: { id: string }; error?: unknown } }
): Promise<void> {
    const files = await glob(pattern, { cwd: dataDir, absolute: true })
    let written = 0
    let skipped = 0

    for (const file of files) {
        const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
        if (!parsed.success || !parsed.data) {
            console.error(`  SKIP ${file.replace(dataDir, '')}: does not match the schema`)
            skipped += 1
            continue
        }
        await firestore.collection(collection).doc(parsed.data.id).set({
            doc: JSON.stringify(parsed.data),
            updatedAt: new Date().toISOString(),
            updatedBy: 'seed',
        })
        written += 1
    }

    console.log(`  ${collection}: ${written} written${skipped ? `, ${skipped} skipped` : ''}`)
}

console.log(`Seeding ${target}…`)
await reportingStoreErrors(async () => {
    await seed('events', 'events/**/*.json', genericEventSchema)
    await seed('players', 'players/*.json', playerSchema)
})
console.log('Done.')
