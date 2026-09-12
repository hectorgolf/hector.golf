import { describe, expect, it } from 'vitest'

import { SIGN_OUT_URL, viewerFromHeaders } from '../src/lib/identity.ts'

/**
 * The header is IAP's, and the admin trusts it completely — a request that did
 * not come through IAP never reaches the process. What is worth holding is the
 * shape of what it carries, since everything the UI says about who you are comes
 * out of these few lines.
 */
describe('who IAP says is calling', () => {
    const headersWith = (email: string) =>
        new Headers({ 'x-goog-authenticated-user-email': email })

    it('drops the provider prefix IAP puts in front of the address', () => {
        const viewer = viewerFromHeaders(headersWith('accounts.google.com:someone@example.com'))
        expect(viewer).toEqual({ email: 'someone@example.com', authenticated: true })
    })

    it('treats a missing or empty header as nobody, rather than as an empty name', () => {
        expect(viewerFromHeaders(new Headers())).toEqual({ authenticated: false })
        expect(viewerFromHeaders(headersWith('accounts.google.com:'))).toEqual({ authenticated: false })
    })
})

/**
 * Signing out is a URL and nothing else, which is what makes it worth a test: a
 * typo in the parameter does not fail, it reloads the page still signed in, and
 * the only symptom is a button that quietly does nothing.
 */
describe('the sign-out link', () => {
    it('asks IAP to clear its cookies, at the app root', () => {
        expect(SIGN_OUT_URL).toBe('/?gcp-iap-mode=CLEAR_LOGIN_COOKIE')
    })
})
