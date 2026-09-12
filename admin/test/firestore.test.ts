import { describe, expect, it, vi } from 'vitest'

// A stub whose listCollections rejects with whatever the test wants, so the
// classification can be exercised without credentials or a network.
function failingWith(error: unknown) {
    vi.resetModules()
    vi.doMock('@google-cloud/firestore', () => ({
        Firestore: class {
            listCollections() {
                return Promise.reject(error)
            }
        },
    }))
    return import('../src/lib/firestore')
}

describe('checkFirestore', () => {
    it('classifies a missing role rather than repeating the error', async () => {
        const { checkFirestore } = await failingWith(
            Object.assign(new Error('7 PERMISSION_DENIED: project 378816462173 …'), { code: 7 })
        )
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const status = await checkFirestore()

        expect(status.reachable).toBe(false)
        expect(status).toMatchObject({ reason: 'permission-denied' })
        // The point of the whole exercise: nothing identifying leaves the process.
        expect(JSON.stringify(status)).not.toContain('378816462173')
        expect(JSON.stringify(status)).not.toContain('PERMISSION_DENIED')
    })

    it('classifies a wrong database id', async () => {
        const { checkFirestore } = await failingWith(Object.assign(new Error('5 NOT_FOUND'), { code: 5 }))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await checkFirestore()).toMatchObject({ reason: 'not-found' })
    })

    it('falls back to unknown for an error carrying no gRPC code', async () => {
        const { checkFirestore } = await failingWith(new Error('something else entirely'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await checkFirestore()).toMatchObject({ reason: 'unknown' })
    })

    it('still logs the full error, so it is recoverable from Cloud Logging', async () => {
        const { checkFirestore } = await failingWith(Object.assign(new Error('7 PERMISSION_DENIED: detail'), { code: 7 }))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        await checkFirestore()

        // Assert on the argument itself rather than a JSON round trip: an Error's
        // `message` is not enumerable, so stringifying the call log hides exactly
        // the thing this test exists to prove is still being logged.
        const args = logged.mock.calls.at(-1) ?? []
        const error = args.find((a): a is Error => a instanceof Error)
        expect(error?.message).toContain('PERMISSION_DENIED')
    })
})

/**
 * The service and the scripts have to agree on which database they mean.
 *
 * They did not: the library defaulted to `(default)` and the scripts to
 * `hector`, so on a laptop `npm run seed` filled one database and `npm run dev`
 * read the other — and the symptom was the admin cheerfully reporting "No
 * tournaments yet" rather than an error, because a read against a database that
 * is not there comes back empty.
 *
 * Importing the constant is what actually makes them agree; this pins the value
 * so that a literal reintroduced in either place fails here.
 */
describe('the database everything in this workspace talks to', () => {
    it('is the one Terraform creates, not the default that does not exist', async () => {
        const { databaseId } = await import('../src/lib/firestore.ts')
        expect(databaseId).toBe('hector')
        expect(databaseId).not.toBe('(default)')
    })

    it('is the same one the scripts write to', async () => {
        const { databaseId } = await import('../src/lib/firestore.ts')
        const { target } = await import('../scripts/store.ts')
        expect(target).toContain(databaseId)
    })
})
