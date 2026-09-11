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

export type FirestoreStatus =
    | { reachable: true; databaseId: string }
    | { reachable: false; databaseId: string; error: string }

/**
 * Listing collections is valid on an empty database and returns nothing, so this
 * answers "can I reach it" without requiring anything to exist yet.
 */
export async function checkFirestore(): Promise<FirestoreStatus> {
    try {
        await firestore().listCollections()
        return { reachable: true, databaseId }
    } catch (error) {
        return {
            reachable: false,
            databaseId,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
