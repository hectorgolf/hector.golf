import { describe, expect, it, vi } from 'vitest'

import { type JobRun, record } from '../src/lib/jobs/log.ts'

/**
 * Writing a run to the log.
 *
 * This had no test, and it was the one piece of the write path that did not.
 * The first real shadow run in production threw here — `Cannot use "undefined"
 * as a Firestore value (found in field "detail")` — was swallowed by `record`'s
 * own catch, and left the Operations page saying "No runs recorded yet" about a
 * job that had just worked perfectly. Nothing failed loudly; the evidence simply
 * never arrived.
 *
 * So the stand-in below rejects `undefined` exactly as the real client does,
 * rather than being a permissive mock that would have passed all day.
 */

/** Firestore's own rule, which a lenient fake would have hidden. */
function rejectUndefined(data: Record<string, unknown>): void {
    for (const [field, value] of Object.entries(data)) {
        if (value === undefined) {
            throw new Error(
                `Value for argument "data" is not a valid Firestore document. ` +
                    `Cannot use "undefined" as a Firestore value (found in field "${field}").`
            )
        }
    }
}

function fakeFirestore() {
    const written = new Map<string, Record<string, unknown>>()
    const db = {
        collection: () => ({
            doc: (id: string) => ({
                set: async (data: Record<string, unknown>) => {
                    rejectUndefined(data)
                    written.set(id, data)
                },
            }),
            // The trim query. Empty, so a run records without needing one.
            where: () => ({ orderBy: () => ({ offset: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }),
        }),
        batch: () => ({ delete: vi.fn(), commit: vi.fn() }),
    }
    return { db: db as any, written }
}

/**
 * A run shaped exactly as `execute.ts` builds one.
 *
 * `detail` and `commit` are spelled out as `undefined` rather than left off, and
 * that is the entire point: the caller always sets every key, so the object
 * reaching Firestore has `detail: undefined` present rather than absent. A
 * helper that merely omitted them passed against the unfixed code — `Object.entries`
 * has nothing to reject when the key was never there — and would have gone on
 * passing while production kept throwing.
 */
const run = (over: Partial<JobRun> = {}): JobRun => ({
    slug: 'handicaps',
    startedAt: '2026-09-16T09:10:15.257Z',
    finishedAt: '2026-09-16T09:10:24.070Z',
    by: 'lasse.koskela@example.com',
    dryRun: true,
    outcome: 'ok',
    detail: undefined,
    changes: [],
    commit: undefined,
    ...over,
})

describe('recording a job run', () => {
    it('writes a successful run that has nothing to explain', async () => {
        // The exact shape that broke: outcome ok, so `detail` and `commit` are
        // both undefined. This is the commonest run there is.
        const { db, written } = fakeFirestore()

        await record(run(), { db })

        const document = written.get('handicaps_2026-09-16T09:10:15.257Z')
        expect(document).toBeDefined()
        expect(document!.outcome).toBe('ok')
    })

    it('omits the absent optional fields rather than storing them as undefined', async () => {
        const { db, written } = fakeFirestore()

        await record(run(), { db })

        const document = written.get('handicaps_2026-09-16T09:10:15.257Z')!
        expect('detail' in document).toBe(false)
        expect('commit' in document).toBe(false)
    })

    it('keeps the optional fields when they have values', async () => {
        const { db, written } = fakeFirestore()

        await record(run({ outcome: 'failed', detail: 'no handicap source answered', commit: 'abc123' }), { db })

        const document = written.get('handicaps_2026-09-16T09:10:15.257Z')!
        expect(document.detail).toBe('no handicap source answered')
        expect(document.commit).toBe('abc123')
    })

    it('keeps the change list, which is the whole point of a shadow run', async () => {
        const { db, written } = fakeFirestore()
        const changes = [{ subject: 'lasse-k', from: '14.7', to: '14.5' }]

        await record(run({ changes }), { db })

        expect(written.get('handicaps_2026-09-16T09:10:15.257Z')!.changes).toEqual(changes)
    })

    it('does not throw when the write fails, because the run itself still happened', async () => {
        // `record` is bookkeeping. A job that did its work must not be reported
        // as failed because the log could not be written — which is also why the
        // production bug was invisible, so the swallowing is deliberate and the
        // test says so.
        const db = {
            collection: () => ({
                doc: () => ({
                    set: async () => {
                        throw new Error('Firestore is having a bad day')
                    },
                }),
            }),
        }

        await expect(record(run(), { db: db as any })).resolves.toBeUndefined()
    })
})
