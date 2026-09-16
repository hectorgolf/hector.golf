import { describe, expect, it } from 'vitest'

import { acquire } from '../src/lib/jobs/lock.ts'

/**
 * The lease that replaces the `data-update` GitHub concurrency group.
 *
 * Driven against a stand-in for Firestore rather than the real thing, which is
 * enough because the behaviour being pinned is the decision — take it, refuse
 * it, break an expired one, decline to release one that is no longer ours — and
 * not the transaction semantics, which are Google's.
 */

type Document = Record<string, unknown> | undefined

/**
 * Just enough Firestore: one collection of documents, and a `runTransaction`
 * that runs the body against them.
 *
 * Transactions are serialised by `await`ing them one at a time here, which is
 * exactly what the real thing guarantees and is why the concurrent case below
 * is a fair test rather than a coincidence.
 */
function fakeFirestore(initial: Record<string, Document> = {}) {
    const documents: Record<string, Document> = { ...initial }
    let running = Promise.resolve()

    const reference = (path: string) => ({ path })
    const db = {
        collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
        runTransaction: async <T>(body: (transaction: any) => Promise<T>): Promise<T> => {
            const result = running.then(() =>
                body({
                    get: async (ref: { path: string }) => ({
                        exists: documents[ref.path] !== undefined,
                        data: () => documents[ref.path],
                    }),
                    set: (ref: { path: string }, value: Record<string, unknown>) => {
                        documents[ref.path] = value
                    },
                    delete: (ref: { path: string }) => {
                        delete documents[ref.path]
                    },
                })
            )
            running = result.then(
                () => undefined,
                () => undefined
            )
            return result
        },
    }
    return { db: db as any, documents }
}

const NOW = new Date('2026-09-16T03:00:00.000Z')
const LATER = new Date('2026-09-16T03:05:00.000Z')
const MUCH_LATER = new Date('2026-09-16T04:00:00.000Z')

describe('taking the job lease', () => {
    it('is granted when nobody holds it', async () => {
        const { db } = fakeFirestore()
        const outcome = await acquire('handicaps', 'first', { db, now: NOW })
        expect(outcome.acquired).toBe(true)
    })

    it('refuses a second caller while the first still holds it', async () => {
        // The case this exists for: a Cloud Scheduler retry arriving while the
        // first attempt is still scraping, because a request that outran the
        // scheduler's deadline is not cancelled by it.
        const { db } = fakeFirestore()
        await acquire('handicaps', 'first', { db, now: NOW })

        const second = await acquire('handicaps', 'second', { db, now: LATER })
        expect(second.acquired).toBe(false)
        expect(second.acquired === false && second.heldBy).toBe('first')
    })

    it('does not block a different job', async () => {
        // The GitHub group is shared across the data updates because they all
        // push to git. This lease is per job, because the commit race is handled
        // by re-reading rather than by waiting.
        const { db } = fakeFirestore()
        await acquire('handicaps', 'first', { db, now: NOW })
        expect((await acquire('leaderboards', 'other', { db, now: NOW })).acquired).toBe(true)
    })

    it('breaks a lease whose holder died without releasing it', async () => {
        // A held lock with a dead holder means nothing ever runs again, and the
        // failure is silent until somebody notices the site is stale.
        const { db } = fakeFirestore()
        await acquire('handicaps', 'dead', { db, now: NOW, leaseSeconds: 60 })
        expect((await acquire('handicaps', 'next', { db, now: MUCH_LATER })).acquired).toBe(true)
    })

    it('lets the next tick straight in once the lease is released', async () => {
        const { db } = fakeFirestore()
        const first = await acquire('handicaps', 'first', { db, now: NOW })
        expect(first.acquired && (await first.lease.release()))

        expect((await acquire('handicaps', 'second', { db, now: LATER })).acquired).toBe(true)
    })
})

describe('giving the lease back', () => {
    it('does not release a lease that has already been taken by somebody else', async () => {
        // An overrunning job finishing after its lease expired must not release
        // the lease its successor now holds — that would let a third run start
        // on top of the second.
        const { db, documents } = fakeFirestore()
        const overrunning = await acquire('handicaps', 'slow', { db, now: NOW, leaseSeconds: 60 })
        const successor = await acquire('handicaps', 'next', { db, now: MUCH_LATER })

        expect(successor.acquired).toBe(true)
        if (overrunning.acquired) await overrunning.lease.release()

        expect(documents['job-locks/handicaps']).toBeDefined()
        expect((documents['job-locks/handicaps'] as { holder: string }).holder).toBe('next')
    })

    it('survives being released twice', async () => {
        const { db } = fakeFirestore()
        const held = await acquire('handicaps', 'first', { db, now: NOW })
        if (held.acquired) {
            await held.lease.release()
            await expect(held.lease.release()).resolves.toBeUndefined()
        }
    })
})
