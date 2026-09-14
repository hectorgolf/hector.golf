import { expect, describe, it, vi, afterEach } from 'vitest'

/**
 * A malformed GOOGLE_CREDENTIALS must not put the value in the log.
 *
 * This branch has fired in production — five runs on 2026-09-01 — and GitHub
 * Actions' secret masking is what kept a private key out of a public log. That
 * held by luck: what reaches the log is a transformed copy, and masking only
 * matched because escaping newlines left the PEM body's lines intact as
 * substrings. Nothing outside Actions masks anything, so a local run printed it
 * in full.
 *
 * `acquireGoogleCredentials()` is not exported and runs at module scope, so the
 * module is re-imported under a stubbed environment rather than called directly.
 */

const SECRET_MARKER = 'thequickbrownfoxjumpsover'
const malformed = `{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\n${SECRET_MARKER}\n-----END PRIVATE KEY-----\n","client_email":"x@y.iam.gserviceaccount.com"`

const importUnder = async (value: string): Promise<string> => {
    vi.resetModules()
    vi.stubEnv('GOOGLE_CREDENTIALS', value)
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args)
    })
    await import('../../../src/code/leaderboards/google-sheets')
    spy.mockRestore()
    return errors.flat().map(String).join(' ')
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('a malformed GOOGLE_CREDENTIALS', () => {
    it('still says what went wrong', async () => {
        const logged = await importUnder(malformed)

        expect(logged).toContain('Error parsing GOOGLE_CREDENTIALS')
    })

    it('does not log the value', async () => {
        const logged = await importUnder(malformed)

        expect(logged).not.toContain(SECRET_MARKER)
        expect(logged).not.toContain('BEGIN PRIVATE KEY')
        expect(logged).not.toContain('client_email')
        expect(logged).not.toContain('service_account')
    })

    it('reports the length, which is what distinguishes truncated from malformed', async () => {
        const logged = await importUnder(malformed)

        expect(logged).toContain(`${malformed.length} characters`)
    })
})

/**
 * An unset GOOGLE_CREDENTIALS is the normal case since the move to Workload
 * Identity Federation: Application Default Credentials resolves the identity,
 * and the module must not treat its absence as a fault. It used to warn that
 * "Google Sheets authentication will not work", which is now exactly backwards.
 */
describe('an unset GOOGLE_CREDENTIALS', () => {
    it('imports without complaining, because ADC is the normal path', async () => {
        vi.resetModules()
        vi.stubEnv('GOOGLE_CREDENTIALS', '')
        const complaints: unknown[][] = []
        const record = (...args: unknown[]) => {
            complaints.push(args)
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(record)
        const error = vi.spyOn(console, 'error').mockImplementation(record)

        await import('../../../src/code/leaderboards/google-sheets')

        warn.mockRestore()
        error.mockRestore()
        expect(complaints.flat().map(String).join(' ')).toBe('')
    })
})
