import { describe, expect, it } from 'vitest'

import { githubTokenSecretLocation } from '../src/lib/secrets.ts'

/**
 * The parsing behind the `gcloud secrets versions add …` command the /updates
 * page prints when the token is missing. Getting it wrong means handing somebody
 * a command that silently targets the wrong secret, which is worse than printing
 * a placeholder and saying so.
 */
describe('locating the secret from its resource name', () => {
    it('pulls the project and secret id out of a versioned resource name', () => {
        expect(githubTokenSecretLocation('projects/hector-golf/secrets/github-dispatch-token/versions/latest')).toEqual(
            { project: 'hector-golf', secretId: 'github-dispatch-token' }
        )
    })

    it('accepts a numeric project and a pinned version, which is how Terraform could also spell it', () => {
        expect(githubTokenSecretLocation('projects/378816462173/secrets/github-dispatch-token/versions/4')).toEqual({
            project: '378816462173',
            secretId: 'github-dispatch-token',
        })
    })

    it('accepts the secret without a version suffix', () => {
        expect(githubTokenSecretLocation('projects/hector-golf/secrets/github-dispatch-token')).toEqual({
            project: 'hector-golf',
            secretId: 'github-dispatch-token',
        })
    })

    it('gives up rather than guessing when there is nothing to parse', () => {
        // The laptop case. The page says so and prints a template instead.
        expect(githubTokenSecretLocation(undefined)).toBeUndefined()
        expect(githubTokenSecretLocation('')).toBeUndefined()
        expect(githubTokenSecretLocation('github-dispatch-token')).toBeUndefined()
        expect(githubTokenSecretLocation('projects/hector-golf/secrets')).toBeUndefined()
    })
})
