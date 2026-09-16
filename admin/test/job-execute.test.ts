import { describe, expect, it } from 'vitest'

import { reportOfThrow } from '../src/lib/jobs/execute.ts'
import { isNotConfigured, NotConfigured } from '../src/lib/jobs/registry.ts'

/**
 * What a thrown job means, and how loudly to say it.
 *
 * The distinction is worth a test rather than a comment because it is about log
 * *levels*, and a wrong level is invisible in every way that matters until the
 * day somebody needs the logs. A deployment with no GitHub token meets
 * `not-configured` on every tick — `GitHubFailure` calls it "expected before the
 * setup step that creates one" — and reporting that as a crash means a stack
 * trace at error level twice a day for a documented, temporary state. The
 * reliable effect is people learning that this service's errors are noise.
 */
describe('what a thrown job means', () => {
    it('treats a missing credential as a skip, and only warns about it', () => {
        const report = reportOfThrow(new NotConfigured('reading astrosite/src/data/handicaps.json'))

        expect(report.outcome).toBe('skipped')
        expect(report.level).toBe('warn')
        expect(report.skipped).toBe('not-configured')
    })

    it('says what was missing, rather than pointing at a stack trace that has nothing in it', () => {
        const report = reportOfThrow(new NotConfigured('reading astrosite/src/data/handicaps.json'))

        expect(report.detail).toContain('astrosite/src/data/handicaps.json')
        expect(report.detail).toContain('GitHub token')
        // The old line, which sent a reader to Cloud Logging for a stack trace
        // that is no longer written and would not have helped.
        expect(report.detail).not.toContain('Cloud Logging')
    })

    /**
     * The half that must not be softened. `readFile` throws on *every* failed
     * read because the reconcile treats `undefined` as "the old pipeline has
     * written nothing", and an unreachable GitHub reported that way would let a
     * run conclude the legacy file was empty and commit over it.
     */
    it('still treats anything else as a failure, loudly', () => {
        for (const error of [
            new Error('Could not read astrosite/src/data/handicaps.json from GitHub: unavailable'),
            new Error('Could not read astrosite/src/data/handicaps.json from GitHub: unauthorized'),
            new TypeError('undefined is not a function'),
            'a string nobody should have thrown',
        ]) {
            const report = reportOfThrow(error)
            expect(report.outcome).toBe('failed')
            expect(report.level).toBe('error')
            expect(report.skipped).toBeUndefined()
        }
    })
})

/**
 * `instanceof` compares constructors, and this module is loaded by Vite in
 * development and from a bundle in production. A second copy of `registry.ts`
 * would make a constructor check quietly false — putting every missing
 * credential back on the error path, in the one environment nobody is watching
 * while it happens.
 */
describe('recognising a NotConfigured that came from somewhere else', () => {
    it('recognises its own', () => {
        expect(isNotConfigured(new NotConfigured('reading a file'))).toBe(true)
    })

    it('recognises one thrown by a second copy of the module', () => {
        // What a duplicate module's class produces: same shape, different
        // constructor. `instanceof` says no to this; the check must say yes.
        const fromElsewhere = Object.assign(new Error('reading a file needs a GitHub token'), {
            notConfigured: true,
            name: 'NotConfigured',
        })

        expect(fromElsewhere instanceof NotConfigured).toBe(false)
        expect(isNotConfigured(fromElsewhere)).toBe(true)
        expect(reportOfThrow(fromElsewhere).level).toBe('warn')
    })

    it('is not fooled by something that merely says so', () => {
        expect(isNotConfigured({ notConfigured: true })).toBe(false)
        expect(isNotConfigured('not configured')).toBe(false)
        expect(isNotConfigured(undefined)).toBe(false)
        expect(isNotConfigured(new Error('not configured'))).toBe(false)
    })
})
