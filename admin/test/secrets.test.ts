import { describe, expect, it } from 'vitest'

import { keyAvailability, secretLocation } from '../src/lib/secrets.ts'

/**
 * The parsing behind the `gcloud secrets versions add …` command the /operations
 * page prints when the token is missing. Getting it wrong means handing somebody
 * a command that silently targets the wrong secret, which is worse than printing
 * a placeholder and saying so.
 */
describe('locating the secret from its resource name', () => {
    it('pulls the project and secret id out of a versioned resource name', () => {
        expect(secretLocation('projects/hector-golf/secrets/github-dispatch-token/versions/latest')).toEqual(
            { project: 'hector-golf', secretId: 'github-dispatch-token' }
        )
    })

    it('accepts a numeric project and a pinned version, which is how Terraform could also spell it', () => {
        expect(secretLocation('projects/378816462173/secrets/github-dispatch-token/versions/4')).toEqual({
            project: '378816462173',
            secretId: 'github-dispatch-token',
        })
    })

    it('accepts the secret without a version suffix', () => {
        expect(secretLocation('projects/hector-golf/secrets/github-dispatch-token')).toEqual({
            project: 'hector-golf',
            secretId: 'github-dispatch-token',
        })
    })

    it('gives up rather than guessing when there is nothing to parse', () => {
        // The laptop case. The page says so and prints a template instead.
        expect(secretLocation(undefined)).toBeUndefined()
        expect(secretLocation('')).toBeUndefined()
        expect(secretLocation('github-dispatch-token')).toBeUndefined()
        expect(secretLocation('projects/hector-golf/secrets')).toBeUndefined()
    })
})

/**
 * Which way the biography key is missing, which decides what /operations tells
 * somebody to go and do. The two failures have different fixes — a deployment
 * that did not carry the variable, against a grant or an empty secret — and
 * `readSecret` collapses both into `undefined`, so the distinction has to be
 * drawn here or not at all.
 */
describe('whether the biography function key can be read', () => {
    it('is readable when there is a key, wherever it came from', () => {
        expect(keyAvailability('projects/hector-golf/secrets/astrosite-api-key/versions/latest', 'abc')).toBe(
            'readable'
        )
    })

    /**
     * The laptop, and the reason the key is checked before the resource name:
     * a developer supplies `ASTROSITE_API_KEY` directly and never reaches this
     * project's Secret Manager. That is a working configuration, not a broken
     * one, and calling it `not-located` would put a panel on every local page.
     */
    it('is readable with no resource name at all, when the environment supplied one', () => {
        expect(keyAvailability(undefined, 'abc')).toBe('readable')
    })

    it('is unreadable when it knows where to look and came back with nothing', () => {
        expect(keyAvailability('projects/hector-golf/secrets/astrosite-api-key/versions/latest', undefined)).toBe(
            'unreadable'
        )
    })

    it('is not located when nothing told this service where the secret is', () => {
        expect(keyAvailability(undefined, undefined)).toBe('not-located')
        expect(keyAvailability('', undefined)).toBe('not-located')
    })
})
