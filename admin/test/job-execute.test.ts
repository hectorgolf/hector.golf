import { describe, expect, it, vi } from 'vitest'

import { publish, reportOfThrow, runNeverStarted } from '../src/lib/jobs/execute.ts'
import { isNotConfigured, NotConfigured } from '../src/lib/jobs/registry.ts'

/**
 * What a thrown job means, and how loudly to say it.
 *
 * The distinction is worth a test rather than a comment because it is about log
 * *levels*, and a wrong level is invisible in every way that matters until the
 * day somebody needs the logs. A deployment with no GitHub token meets
 * `not-configured` on every tick — `GitHubFailure` calls it "expected before the
 * setup step that creates one" — and reporting that as a crash means a stack
 * trace at error level four times a day for a documented, temporary state. The
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

/**
 * Who asks for a deploy after a job has changed something.
 *
 * This exists because of a gap step 2 opened deliberately and step 3 had to
 * close: the backup lives outside `astrosite/`, so committing it does not trip
 * `deploy-site.yml`'s path filter, and once the site builds from the API there
 * is nothing else to publish a change. Every rule below is about *not* asking,
 * because a spurious deploy is the failure this arrangement was built to avoid
 * and a missing one is a page that is quietly a day out of date.
 */
describe('asking for a deploy after a job run', () => {
    const job = {
        slug: 'handicaps',
        label: "Players' official handicaps",
        blurb: '',
        dryRun: false,
        scheduled: true,
        publishes: true,
        run: async () => ({ outcome: 'ok' as const, changes: [] }),
    }

    const dispatcher = () => {
        const asked: string[] = []
        return {
            asked,
            dispatch: async (workflow: { file: string }) => {
                asked.push(workflow.file)
                return { ok: true as const }
            },
        }
    }

    it('asks, when a job that publishes found something', async () => {
        const { asked, dispatch } = dispatcher()
        await publish(job, 'ok', 1, false, dispatch)
        expect(asked).toEqual(['deploy-site.yml'])
    })

    /*
     * The reconcile tick. A run commits whenever the render differs from git,
     * which includes bringing in the old workflow's row for a handicap already
     * known about — same values, same daily view, nothing on any page to
     * redraw. Deploying for those would put the count back to the three per
     * change that moving the backup removed.
     */
    it('does not ask when the run changed nothing, even though it may have committed', async () => {
        const { asked, dispatch } = dispatcher()
        await publish(job, 'ok', 0, false, dispatch)
        expect(asked).toEqual([])
    })

    it('does not ask for a shadow run, which wrote nothing to publish', async () => {
        const { asked, dispatch } = dispatcher()
        await publish({ ...job, dryRun: true }, 'ok', 3, false, dispatch)
        expect(asked).toEqual([])
    })

    it('does not ask when the run failed or was skipped', async () => {
        const { asked, dispatch } = dispatcher()
        await publish(job, 'failed', 3, false, dispatch)
        await publish(job, 'skipped', 3, false, dispatch)
        expect(asked).toEqual([])
    })

    it('does not ask for a job whose output the site does not build from', async () => {
        // The reason this is a flag rather than a rule about all jobs: the next
        // ones are not all like handicaps, and a job maintaining internal state
        // should not be spending a build on it.
        const { asked, dispatch } = dispatcher()
        await publish({ ...job, publishes: false }, 'ok', 3, false, dispatch)
        expect(asked).toEqual([])
    })

    /*
     * A deploy that did not start is a page that is late, and the deploy entry's
     * own `cadence: { every: '1d' }` eventually publishes it anyway. Reporting
     * the *run* failed would be worse than the problem: it sends somebody to
     * look at a scrape that worked perfectly.
     */
    it('does not ask when a commit under astrosite/ has already started a deploy', async () => {
        // The bucket recompute commits event files, which `deploy-site.yml`
        // watches — and a commit made with this service's token does trigger
        // workflows, unlike one made with GITHUB_TOKEN. Asking as well would
        // build the same commit twice.
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const { asked, dispatch } = dispatcher()
        await publish(job, 'ok', 3, true, dispatch)
        expect(asked).toEqual([])
    })

    it('still asks when the only changes were outside astrosite/', async () => {
        // The observation-log backup lives outside that tree on purpose, so
        // nothing else will publish a handicap this run found.
        const { asked, dispatch } = dispatcher()
        await publish(job, 'ok', 3, false, dispatch)
        expect(asked.length).toBe(1)
    })

    it('does not throw when GitHub refuses, because the data is already committed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const refuse = async () => ({ ok: false as const, reason: 'unauthorized' as const })

        await expect(publish(job, 'ok', 1, false, refuse)).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
})

describe('telling a run that never started from a job that declined', () => {
    /**
     * Both are recorded as `skipped`, and to the run log that is right: nothing
     * was written either way. To somebody who just pressed Run it is not, and
     * reading the outcome alone is what put "another run of it was already
     * going" in front of an admin whose biographies job had simply declined.
     */
    it('is the harness that did not start it, for the two it decides', () => {
        expect(runNeverStarted({ outcome: 'skipped', skipped: 'lease' })).toBe(true)
        expect(runNeverStarted({ outcome: 'skipped', skipped: 'not-configured' })).toBe(true)
    })

    it('is not, when the job itself ran and declined', () => {
        expect(runNeverStarted({ outcome: 'skipped' })).toBe(false)
    })

    it('is not, for a run that acted or failed', () => {
        expect(runNeverStarted({ outcome: 'ok' })).toBe(false)
        expect(runNeverStarted({ outcome: 'failed' })).toBe(false)
    })
})
