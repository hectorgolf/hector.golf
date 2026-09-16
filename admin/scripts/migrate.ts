/**
 * Import every committed data file into Firestore, and check it survives.
 *
 * This is step 1 of `docs/plans/everything-to-firestore.md`, and it is also the
 * thing that plan says should decide whether to take it at all. Everything that
 * makes a big-bang cutover dangerous is downstream of one question — do 89 files
 * read back as the same data they were written as — and that question is
 * answerable today, offline, against the files that already exist.
 *
 * So `--check` does exactly that and writes nothing:
 *
 *     npm run migrate -- --check     # parse, round-trip, diff, report. No writes.
 *     npm run migrate                # the same, then write what passed
 *     FIRESTORE_EMULATOR_HOST=localhost:8432 npm run migrate
 *
 * `--check` needs no credentials and no database, which is the point: anybody
 * can run it on a laptop before a decision is made.
 *
 * ## Idempotent, deliberately
 *
 * Every record gets a derived id from `COLLECTIONS`, so a second run overwrites
 * the same documents rather than doubling the collection. That matters more than
 * it sounds: this script is expected to be run repeatedly while the rest of the
 * migration is built, against a database the admin is already reading.
 *
 * ## It runs once
 *
 * Its input is `astrosite/src/data/`, which step 5 of the plan deletes. So this
 * is usable on any checkout up to that commit and not afterwards — which is the
 * intended shape of a migration and is why it is a script rather than an
 * endpoint. Re-running it later means checking out the commit before the
 * deletion, which is also exactly what a recovery would do.
 *
 * ## What it does not do
 *
 * It does not delete. A document in Firestore with no corresponding file is left
 * alone and reported, because the two cases — a record the admin authored and a
 * file somebody deleted — are indistinguishable from here and have opposite
 * correct answers.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'glob'

import { COLLECTIONS, type CollectionSpec } from '../src/lib/data/collections.ts'
import { firestore, reportingStoreErrors, target } from './store.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '../../astrosite/src/data')

const checkOnly = process.argv.includes('--check')

type MigrationRecord = { id: string; data: unknown; from: string }

/**
 * JSON with object keys sorted, so two records differ only when their *data*
 * differs.
 *
 * Zod rebuilds an object in the order its schema declares keys, which for
 * `handicaps.json` alone reported all 1,406 entries as changed when the
 * comparison was a plain `JSON.stringify`. None of them had.
 */
function canonical(value: unknown): string {
    const sorted = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(sorted)
        if (node && typeof node === 'object') {
            return Object.fromEntries(
                Object.keys(node as object)
                    .sort()
                    .map((key) => [key, sorted((node as Record<string, unknown>)[key])])
            )
        }
        return node
    }
    return JSON.stringify(sorted(value))
}

type Report = {
    collection: string
    parsed: number
    rejected: Array<{ from: string; why: string }>
    duplicates: string[]
    notRoundTripped: string[]
}

/**
 * Read one collection's records off disk, validated and keyed.
 *
 * ## What is stored is the raw record, not the parsed one
 *
 * The schema validates; it does not filter. That distinction is the single most
 * important line in this script, and it was written the other way round first.
 *
 * `courses` is why. Thirteen of the seventeen course files carry fields the
 * course schema does not mention — `images.hero` on eight of them, `name_cz` on
 * the Konopiště tees, `par_ladies` at Sand Valley, and 70-odd Finnish per-hole
 * descriptions across the two Tahko courses. Zod strips unknown keys, so a
 * migration that stored `parsed.data` would write those files to Firestore
 * without them.
 *
 * Today that is harmless: nothing reads those fields, and the files are the
 * source of truth, so the dormant content sits in git waiting for somebody to
 * render it. After step 5 deletes the files it would be gone — quietly, with the
 * only copy overwritten by a migration that reported success.
 *
 * So: parse to prove the record is readable, store the original.
 *
 * ## The round-trip report
 *
 * Kept, but as information rather than an objection. It answers "is the schema
 * narrower than the data", which is worth knowing — for courses the answer is
 * yes and somebody should decide whether those fields are wanted — and it is
 * compared ignoring key order, because zod rebuilds objects in schema order and
 * that is not a difference in the data.
 */
export async function readCollection(collection: CollectionSpec): Promise<{ records: MigrationRecord[]; report: Report }> {
    const report: Report = { collection: collection.name, parsed: 0, rejected: [], duplicates: [], notRoundTripped: [] }
    const records: MigrationRecord[] = []
    const seen = new Set<string>()

    const files = collection.singleFile
        ? [join(dataDir, collection.source)]
        : await glob(collection.source, { cwd: dataDir, absolute: true })

    for (const file of files.sort()) {
        const shortName = file.replace(`${dataDir}/`, '')
        let raw: unknown
        try {
            raw = JSON.parse(readFileSync(file, 'utf-8'))
        } catch (error) {
            report.rejected.push({ from: shortName, why: `not valid JSON: ${error}` })
            continue
        }

        // A single-file collection is an array of records; a per-record file is
        // one record. Normalised here so everything below sees a list.
        const entries: unknown[] = collection.singleFile ? (raw as unknown[]) : [raw]

        entries.forEach((entry, index) => {
            const parsed = collection.schema.safeParse(entry)
            if (!parsed.success) {
                report.rejected.push({
                    from: collection.singleFile ? `${shortName}[${index}]` : shortName,
                    why: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
                })
                return
            }

            const id = collection.id(parsed.data, index)
            if (!id) {
                report.rejected.push({ from: shortName, why: 'produced no document id' })
                return
            }
            if (seen.has(id)) {
                // Two records that would occupy one document. The second would
                // silently overwrite the first, and the collection would be
                // quietly shorter than the files it came from.
                report.duplicates.push(id)
                return
            }
            seen.add(id)

            if (canonical(parsed.data) !== canonical(entry)) {
                report.notRoundTripped.push(id)
            }

            report.parsed += 1
            // The raw entry, not `parsed.data`. See the note above.
            records.push({ id, data: entry, from: shortName })
        })
    }

    return { records, report }
}

/** Write a collection, in batches Firestore will accept. */
async function write(collection: CollectionSpec, records: MigrationRecord[]): Promise<void> {
    for (let index = 0; index < records.length; index += 400) {
        const batch = firestore.batch()
        for (const record of records.slice(index, index + 400)) {
            batch.set(firestore.collection(collection.name).doc(record.id), record.data as object)
        }
        await batch.commit()
    }
}

async function main(): Promise<void> {
    console.log(checkOnly ? 'Checking the committed data files. Nothing will be written.' : `Writing to ${target}`)
    console.log()

    const reports: Report[] = []
    let total = 0

    for (const collection of COLLECTIONS) {
        const { records, report } = await readCollection(collection)
        reports.push(report)
        total += records.length

        const problems = report.rejected.length + report.duplicates.length
        console.log(`${problems === 0 ? '  OK  ' : ' WARN '} ${collection.name}: ${report.parsed} records`)

        for (const rejected of report.rejected) console.log(`         rejected ${rejected.from}: ${rejected.why}`)
        for (const duplicate of report.duplicates) console.log(`         duplicate id: ${duplicate}`)
        if (report.notRoundTripped.length > 0) {
            // Summarised rather than listed. Thirteen course files is a useful
            // sentence; 1,406 ids was a scroll.
            const sample = report.notRoundTripped.slice(0, 3).join(', ')
            const rest = report.notRoundTripped.length - 3
            console.log(
                `         ${report.notRoundTripped.length} record(s) carry fields the schema does not read` +
                    ` (${sample}${rest > 0 ? `, +${rest} more` : ''}).`
            )
            console.log(`         Stored in full regardless. Worth deciding whether the site should read them.`)
        }

        if (!checkOnly && report.rejected.length === 0 && report.duplicates.length === 0) {
            await reportingStoreErrors(() => write(collection, records))
        } else if (!checkOnly) {
            // Refused rather than partially written. A collection the site reads
            // in full is one where "most of it" is a worse state than "none of
            // it": the missing records would render as absent rather than as an
            // error, and nothing would say which.
            console.log(`         NOT WRITTEN — fix the above first`)
        }
    }

    console.log()
    // Deliberately not including `notRoundTripped`: a schema narrower than the
    // data is a question for a person, not a reason to refuse the migration —
    // the record is stored whole either way.
    const clean = reports.every((report) => report.rejected.length === 0 && report.duplicates.length === 0)
    console.log(`${total} records across ${COLLECTIONS.length} collections.`)

    if (clean) {
        console.log(
            checkOnly
                ? 'Every file parses and keys uniquely. The cutover risk is the low one.'
                : 'Written.'
        )
    } else {
        console.log('Not clean. See above — and note that this is not an argument for the incremental')
        console.log('plan instead, which has the same problem and finds it later.')
        process.exitCode = 1
    }
}

// Only when this file is the thing being run: `snapshot.ts` imports the reader
// above, and an import must not perform a migration.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    await main()
}
