import { describe, expect, it } from 'vitest'

import {
    DEFAULT_PROJECT,
    KEY_BYTES,
    SECRET_ID,
    generateKey,
    parseOptions,
    report,
    versionNumber,
} from '../scripts/rotate-hooks-key.ts'

/**
 * The rotation script, minus the part that talks to Secret Manager.
 *
 * What is worth pinning is not the API call — that is one method with no
 * branching — but the things around it that a person acts on: that the key is
 * actually random and long enough, that a typo in a flag cannot silently point
 * a rotation at the wrong project, and that what gets printed says the two
 * operationally important things. A rotation whose output forgets to mention
 * that the old key just died is worse than no script.
 *
 * Importing this file must not mint anything, which the `argv[1]` guard at the
 * bottom of the script is for. That this suite passes at all is that guard
 * being tested.
 */

describe('the key it generates', () => {
    it('carries 32 bytes of randomness', () => {
        expect(KEY_BYTES).toBe(32)
        expect(Buffer.from(generateKey(), 'base64')).toHaveLength(32)
    })

    it('is base64, so it survives a copy-paste into a config file', () => {
        expect(generateKey()).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    })

    it('is different every time', () => {
        const keys = new Set(Array.from({ length: 50 }, generateKey))
        expect(keys.size).toBe(50)
    })
})

describe('the options it reads', () => {
    it('defaults to the project this repository describes', () => {
        expect(parseOptions([], {}).project).toBe(DEFAULT_PROJECT)
    })

    it('prefers an explicit --project to the environment', () => {
        expect(parseOptions(['--project=somewhere-else'], { GCLOUD_PROJECT_ID: 'from-env' }).project).toBe(
            'somewhere-else'
        )
    })

    it('takes the project from either environment variable', () => {
        expect(parseOptions([], { GCLOUD_PROJECT_ID: 'a' }).project).toBe('a')
        expect(parseOptions([], { GOOGLE_CLOUD_PROJECT: 'b' }).project).toBe('b')
    })

    it('is not dry by default, because the point of running it is to rotate', () => {
        expect(parseOptions([], {}).dryRun).toBe(false)
        expect(parseOptions(['--dry-run'], {}).dryRun).toBe(true)
    })

    it('does not mistake a near miss for a flag', () => {
        // A rotation is not undoable by re-running it: every run burns a
        // version and locks the other side out again. A `--dryrun` that was
        // read as "go ahead" is the expensive typo here.
        for (const argument of ['--dryrun', '-dry-run', 'dry-run', '--dry']) {
            expect(parseOptions([argument], {}).dryRun, argument).toBe(false)
        }
    })

    it('reads --quiet, for piping the key into a clipboard', () => {
        expect(parseOptions(['--quiet'], {}).quiet).toBe(true)
    })
})

describe('what it says afterwards', () => {
    const base = { project: 'hector-golf', version: '4' }

    it('says the old key has already stopped working', () => {
        // The fact somebody has to know before they walk away from the
        // terminal: there is no overlap window, because the service resolves
        // versions/latest per request.
        const text = report({ ...base, enabledVersions: ['4'] })
        expect(text).toMatch(/STOPPED WORKING/)
        expect(text).toMatch(/locked out/)
    })

    it('gives the command that undoes it', () => {
        const text = report({ ...base, enabledVersions: ['4'] })
        expect(text).toContain(`gcloud secrets versions disable 4 --secret=${SECRET_ID} --project=hector-golf`)
    })

    it('names the older versions still enabled, and only those', () => {
        const text = report({ ...base, enabledVersions: ['2', '3', '4'] })
        expect(text).toMatch(/2 older enabled version/)
        expect(text).toContain('disable 2 3 --secret=')
    })

    it('says nothing about tidying up when there is nothing to tidy', () => {
        expect(report({ ...base, enabledVersions: ['4'] })).not.toMatch(/older enabled version/)
    })

    it('never contains the key itself', () => {
        // The report is logged; the key is printed separately and deliberately.
        // Anything that put the value into this string would put it somewhere a
        // future change might redirect to a log.
        const text = report({ ...base, enabledVersions: ['3', '4'] })
        expect(text).not.toMatch(/[A-Za-z0-9+/]{40,}/)
    })
})

describe('the version number it reports', () => {
    it('is the last segment of the resource name', () => {
        expect(versionNumber('projects/378816462173/secrets/hooks-api-key/versions/7')).toBe('7')
    })

    it('says so rather than throwing when there is no name', () => {
        expect(versionNumber(undefined)).toBe('unknown')
        expect(versionNumber(null)).toBe('unknown')
    })
})
