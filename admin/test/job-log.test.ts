import { describe, expect, it, vi } from 'vitest'

import { type JobRun, record } from '../src/lib/jobs/log.ts'
import { KEEP_FOR_DAYS, TRIM_BATCH } from '../src/lib/retention.ts'

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

/**
 * A stand-in that remembers what was written and what the trim asked for.
 *
 * `expired` is what the trim query is told to return — empty by default, so an
 * ordinary run records without tidying anything up, which is the common case.
 */
function fakeFirestore(expired: string[] = []) {
    const written = new Map<string, Record<string, unknown>>()
    const deleted: string[] = []
    const trim = { field: '', op: '', cutoff: '', limit: 0 }
    const db = {
        collection: () => ({
            doc: (id: string) => ({
                set: async (data: Record<string, unknown>) => {
                    rejectUndefined(data)
                    written.set(id, data)
                },
            }),
            where: (field: string, op: string, cutoff: string) => {
                Object.assign(trim, { field, op, cutoff })
                return {
                    limit: (limit: number) => {
                        trim.limit = limit
                        return {
                            get: async () => ({
                                empty: expired.length === 0,
                                docs: expired.map((id) => ({ ref: id })),
                            }),
                        }
                    },
                }
            },
        }),
        batch: () => ({
            delete: (ref: string) => deleted.push(ref),
            commit: vi.fn(),
        }),
    }
    return { db: db as any, written, deleted, trim }
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

describe('keeping the log to its retention', () => {
    const now = new Date('2026-09-18T09:00:00.000Z')

    it('asks for the runs that have aged out, whichever job wrote them', async () => {
        const { db, trim } = fakeFirestore()

        await record(run(), { db, now })

        // One inequality on one field, and no slug: retention is a property of
        // the log rather than of each job, and this shape is served by the
        // automatic index rather than by a composite one somebody has to
        // remember to create.
        expect([trim.field, trim.op]).toEqual(['startedAt', '<'])
        expect(trim.cutoff).toBe('2026-03-22T09:00:00.000Z')
        expect(new Date(trim.cutoff).getTime()).toBe(now.getTime() - KEEP_FOR_DAYS * 24 * 60 * 60 * 1000)
    })

    it('deletes what it found, in one bounded batch', async () => {
        const { db, deleted, trim } = fakeFirestore(['handicaps_2026-01-02T03:00:00Z', 'handicaps_2026-01-03T03:00:00Z'])

        await record(run(), { db, now })

        expect(deleted).toEqual(['handicaps_2026-01-02T03:00:00Z', 'handicaps_2026-01-03T03:00:00Z'])
        // Under Firestore's 500-write batch limit, and a bound rather than a
        // target: the tick that finds a thousand expired runs is the one that
        // must not issue a thousand deletes.
        expect(trim.limit).toBe(TRIM_BATCH)
        expect(TRIM_BATCH).toBeLessThan(500)
    })

    it('still records the run when the tidying up fails', async () => {
        // The trim is best-effort and deliberately not part of the caller's
        // success: a run that did its work and then failed to tidy up is a run
        // that worked.
        const written = new Map<string, Record<string, unknown>>()
        const db = {
            collection: () => ({
                doc: (id: string) => ({ set: async (data: Record<string, unknown>) => void written.set(id, data) }),
                where: () => ({
                    limit: () => ({
                        get: async () => {
                            throw new Error('Firestore is having a bad day')
                        },
                    }),
                }),
            }),
        }

        await expect(record(run(), { db: db as any, now })).resolves.toBeUndefined()
        expect(written.has('handicaps_2026-09-16T09:10:15.257Z')).toBe(true)
    })
})
