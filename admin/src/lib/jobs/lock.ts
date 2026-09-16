import type { Firestore } from '@google-cloud/firestore'

import { firestore } from '../firestore.ts'

/**
 * One data job at a time, across all of them.
 *
 * ## What this replaces
 *
 * The four data-update workflows share a GitHub concurrency group named
 * `data-update` — deliberately shared rather than one per workflow, because
 * every one of them ends in `git pull -r && git push` and any two that overlap
 * race over the same push. GitHub serialises them for free.
 *
 * A job that runs inside this service has no such interlock. Cloud Run is
 * configured for `max_instance_count = 2`; Cloud Scheduler fires six times a day
 * with `retry_count = 3`; and a retry after a timeout arrives while the first
 * attempt is very much still running, because a Cloud Run request that exceeds
 * the scheduler's deadline is not cancelled by it. Without this, the first two
 * jobs to move into the service reintroduce exactly the race the shared group
 * was created to stop, and they reintroduce it against `main`.
 *
 * ## Why a lease rather than a lock
 *
 * A held lock whose holder has died is worse than no lock: nothing ever runs
 * again, and the failure is silent until somebody notices the site is stale. So
 * this is a *lease* with an expiry, and a lease that has expired can be taken by
 * the next caller. `LEASE_SECONDS` is therefore an assertion about the longest a
 * job may legitimately take, and it is set generously — a sweep of 45 players
 * against a slow WiseGolf, plus two GitHub round trips, against a Cloud Run
 * request timeout that is shorter than this anyway.
 *
 * The expiry is compared against the server's clock rather than Firestore's,
 * which is a known and accepted imprecision: the two are both Google's and are
 * within milliseconds, and the consequence of being wrong is a duplicate run
 * rather than a corrupt one.
 *
 * ## What a duplicate run would actually cost
 *
 * Not nothing, but not correctness. Two sweeps produce two readings, which is a
 * supported outcome — `latestPerDay` decides which one the site shows. The real
 * cost is two commits racing over the same file, which the contents API answers
 * with a 409 and the caller retries. This exists to make that rare rather than
 * to make it survivable; it is already survivable.
 */

/** The collection holding one document per job slug. */
export const LOCKS = 'job-locks'

/**
 * How long a lease is good for.
 *
 * Longer than any job should take and shorter than the interval between ticks,
 * which are an hour apart in the morning window. Both halves matter: shorter
 * than a job and a second tick starts on top of the first; longer than the
 * interval and one stuck job silently skips every run until someone looks.
 */
export const LEASE_SECONDS = 15 * 60

export type Lease = {
    /** Hand the lease back, so the next tick does not have to wait it out. */
    release(): Promise<void>
}

export type LeaseOutcome =
    | { acquired: true; lease: Lease }
    | { acquired: false; heldBy: string; since: string }

type LockDocument = {
    holder: string
    acquiredAt: string
    expiresAt: string
}

export type AcquireOptions = {
    /** Injectable so the tests do not need a Firestore. */
    db?: Firestore
    now?: Date
    leaseSeconds?: number
}

/**
 * Take the lease for `slug`, or report who has it.
 *
 * The read and the write are one transaction, which is the entire reason this is
 * in Firestore rather than in a variable: two Cloud Run instances share nothing
 * else, and a check-then-write that is not atomic is a race with extra steps.
 */
export async function acquire(slug: string, holder: string, options: AcquireOptions = {}): Promise<LeaseOutcome> {
    const db = options.db ?? firestore()
    const now = options.now ?? new Date()
    const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS
    const reference = db.collection(LOCKS).doc(slug)

    const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()

    const outcome = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference)
        const existing = snapshot.exists ? (snapshot.data() as LockDocument) : undefined

        if (existing && existing.expiresAt > now.toISOString()) {
            return { acquired: false as const, heldBy: existing.holder, since: existing.acquiredAt }
        }

        if (existing) {
            // Worth a line in Cloud Logging: a lease that had to be broken means
            // a previous run died without releasing, which is not visible
            // anywhere else.
            console.warn('Breaking an expired job lease', {
                slug,
                previousHolder: existing.holder,
                expiredAt: existing.expiresAt,
            })
        }

        transaction.set(reference, {
            holder,
            acquiredAt: now.toISOString(),
            expiresAt,
        } satisfies LockDocument)
        return { acquired: true as const }
    })

    if (!outcome.acquired) return outcome

    return {
        acquired: true,
        lease: {
            async release() {
                // Conditional on still being the holder. A job that overran its
                // lease has already had it taken by somebody else, and deleting
                // the document then would release a lease it does not hold —
                // letting a third run start on top of the second.
                await db.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(reference)
                    const current = snapshot.exists ? (snapshot.data() as LockDocument) : undefined
                    if (current?.holder === holder && current?.acquiredAt === now.toISOString()) {
                        transaction.delete(reference)
                    } else if (current) {
                        console.warn('Not releasing a job lease that is no longer ours', {
                            slug,
                            heldBy: current.holder,
                        })
                    }
                })
            },
        },
    }
}
