/**
 * Where the scripts write, and the two things that were easy to get wrong.
 *
 * Both `seed` and `export` talk to the same database and both used to build
 * their own client, which is how they came to disagree with reality in the same
 * way twice.
 */
import { Firestore } from '@google-cloud/firestore'

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'hector-golf'

/**
 * Not `(default)`.
 *
 * Terraform names this project's database `hector`, and there is no default
 * database in the project at all — so `(default)` is not a safe fallback here,
 * it is a guaranteed failure. It also fails badly: Firestore answers a read on a
 * database that does not exist with `5 NOT_FOUND` and an empty message, which
 * reads like an empty collection rather than the wrong database.
 */
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'hector'

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
