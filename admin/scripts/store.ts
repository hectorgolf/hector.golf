/**
 * Where the scripts write, and the two things that were easy to get wrong.
 *
 * Both `seed` and `export` talk to the same database and both used to build
 * their own client, which is how they came to disagree with reality in the same
 * way twice.
 */
import { Firestore } from '@google-cloud/firestore'

import { databaseId as DATABASE } from '../src/lib/firestore.ts'

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'hector-golf'

/** Printed before anything happens, so the wrong target is visible immediately. */
export const target = process.env.FIRESTORE_EMULATOR_HOST
    ? `${process.env.FIRESTORE_EMULATOR_HOST} (emulator), database "${DATABASE}"`
    : `projects/${PROJECT}/databases/${DATABASE}`

export const firestore = new Firestore({ projectId: PROJECT, databaseId: DATABASE })

/** Turns `5 NOT_FOUND` and a page of gRPC frames into the sentence that helps. */
export async function reportingStoreErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work()
    } catch (error) {
        if ((error as { code?: number })?.code === 5) {
            throw new Error(
                `No database at ${target}.\n` +
                    `Set FIRESTORE_DATABASE_ID to the one you meant — ` +
                    `\`gcloud firestore databases list --project=${PROJECT}\` lists them.`
            )
        }
        throw error
    }
}
