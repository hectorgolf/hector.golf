import { Firestore } from '@google-cloud/firestore'

/**
 * Which database to talk to. Set by `terraform/cloud_run.tf` from the database
 * resource, so the deployed service and the Terraform that created the database
 * cannot disagree. Unset locally, where the client falls back to `(default)` —
 * a *different* database, and one this project has no free tier left to spare.
 */
export const databaseId = process.env.FIRESTORE_DATABASE_ID ?? '(default)'

/**
 * Built on first use, not at import time: constructing it resolves credentials,
 * and `astro check`, the tests and a laptop that has never authenticated must all
 * work without any. Only a request that actually reads data should need them.
 */
let client: Firestore | undefined

export function firestore(): Firestore {
    client ??= new Firestore({ databaseId })
    return client
}

/**
 * Why the database could not be reached, in terms safe to hand to a browser.
 *
 * The raw error is not one of those terms. It carries project numbers, internal
 * hostnames and credential detail, and this service is built to be deployed a
 * second time *without* IAP in front of it as the public site — so anything a
 * response body can carry should be assumed public, not admin-only.
 *
 * These map from gRPC status codes, which is enough to tell the three cases
 * apart that actually need different actions: the service account lacks a role,
 * the database id is wrong, or Firestore is having a bad day.
 */
export type UnreachableReason =
    | 'permission-denied'
    | 'unauthenticated'
    | 'not-found'
    | 'unavailable'
    | 'deadline-exceeded'
    | 'unknown'

/** https://grpc.github.io/grpc/core/md_doc_statuscodes.html */
const REASON_BY_GRPC_CODE: Record<number, UnreachableReason> = {
    4: 'deadline-exceeded',
    5: 'not-found',
    7: 'permission-denied',
    14: 'unavailable',
    16: 'unauthenticated',
}

function classify(error: unknown): UnreachableReason {
    const code = (error as { code?: unknown })?.code
    return (typeof code === 'number' && REASON_BY_GRPC_CODE[code]) || 'unknown'
}

export type FirestoreStatus =
    | { reachable: true; databaseId: string }
    | { reachable: false; databaseId: string; reason: UnreachableReason }

/**
 * Listing collections is valid on an empty database and returns nothing, so this
 * answers "can I reach it" without requiring anything to exist yet.
 *
 * The full error goes to stderr, which Cloud Run collects into Cloud Logging.
 * That is where to look when the reason alone is not enough — deliberately a
 * place that requires a Google Cloud role to read, rather than a page load.
 */
export async function checkFirestore(): Promise<FirestoreStatus> {
    try {
        await firestore().listCollections()
        return { reachable: true, databaseId }
    } catch (error) {
        console.error('Firestore unreachable', { databaseId }, error)
        return { reachable: false, databaseId, reason: classify(error) }
    }
}
