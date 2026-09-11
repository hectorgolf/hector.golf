import { Firestore } from "@google-cloud/firestore";

import { firestoreDatabaseId } from "./config.ts";

/**
 * The Firestore client, created on first use rather than at import time.
 *
 * Lazily, because constructing it resolves credentials, and the tests and
 * `npm run typecheck` must not need any. A request that actually touches
 * Firestore will fail without them; nothing else should.
 */
let client: Firestore | undefined;

export function firestore(): Firestore {
    client ??= new Firestore({ databaseId: firestoreDatabaseId });
    return client;
}

export type FirestoreStatus =
    | { reachable: true; databaseId: string }
    | { reachable: false; databaseId: string; error: string };

/**
 * A cheap round trip that proves credentials, network and database id all line up.
 *
 * Listing collections on an empty database is valid and returns nothing, so this
 * answers "can I talk to it" without needing anything to exist yet.
 */
export async function checkFirestore(): Promise<FirestoreStatus> {
    try {
        await firestore().listCollections();
        return { reachable: true, databaseId: firestoreDatabaseId };
    } catch (error) {
        return {
            reachable: false,
            databaseId: firestoreDatabaseId,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
