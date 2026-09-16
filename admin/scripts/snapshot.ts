/**
 * Write `astrosite/src/data/snapshot.json` from the committed data files.
 *
 * The bootstrap half of the fallback described in
 * `docs/plans/everything-to-firestore.md`: it produces the first snapshot from
 * what is in git, so that the file exists before Firestore is the thing
 * producing it. After the cutover the admin rewrites it on change, and this
 * script's remaining use is regenerating the fallback from a Firestore export
 * during a recovery.
 *
 * Two sources, one output:
 *
 *     npm run snapshot                  # from Firestore. The normal case.
 *     npm run snapshot -- --from-files  # from the committed data files.
 *
 * Firestore is the default because it is the only source that still exists after
 * step 5 of the plan. The data workflows run this after writing: the fallback
 * has to keep up with the database, or the first fork to build the site
 * publishes whatever was true on cutover day.
 *
 * `--from-files` is the bootstrap, and it works exactly once — on a checkout
 * where `astrosite/src/data/` still holds the 89 files. It reuses
 * `migrate.ts`'s reader, so the first snapshot and the migration cannot disagree
 * about what a collection contains. After the deletion commit it has nothing to
 * read and says so, which is correct rather than unfortunate.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COLLECTIONS, snapshotKey } from '../src/lib/data/collections.ts'
import { readCollection } from './migrate.ts'
import { firestore, reportingStoreErrors, target } from './store.ts'

const fromFiles = process.argv.includes('--from-files')

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '../../astrosite/src/data/snapshot.json')

const payload: Record<string, unknown> = {
    // Dated from the source rather than from the clock, so regenerating an
    // unchanged snapshot produces an unchanged file and not a commit.
    generatedAt: '1970-01-01T00:00:00Z',
}

let total = 0
for (const collection of COLLECTIONS) {
    let records: unknown[]

    if (!fromFiles) {
        const documents = await reportingStoreErrors(() => firestore.collection(collection.name).get())
        records = documents.docs.map((document) => document.data())

        // An empty collection is almost always a wrong database or a failed
        // migration rather than a real state, and writing it would replace a
        // good fallback with an empty one — which then builds a site with no
        // courses on it and reports success. Refusing costs a stale fallback;
        // continuing costs the fallback entirely.
        if (records.length === 0) {
            console.error(`${collection.name} is empty in ${target}. Refusing to overwrite the snapshot.`)
            process.exit(1)
        }
    } else {
        const read = await readCollection(collection)
        if (read.report.rejected.length > 0 || read.report.duplicates.length > 0) {
            console.error(`${collection.name}: refusing to snapshot a collection with problems. Run migrate --check.`)
            process.exit(1)
        }
        records = read.records.map((record) => record.data)
    }

    payload[snapshotKey(collection)] = records
    total += records.length
}

// Two-space JSON with a trailing newline, matching `astrosite/src/code/json.ts`
// — the file lives under `src/data/`, which `.prettierignore` covers precisely
// so that a formatter cannot fight the writer.
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`Wrote ${total} records across ${COLLECTIONS.length} collections to ${out}`)
