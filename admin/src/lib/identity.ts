/**
 * Who is making this request, and what they are allowed to do.
 *
 * ## Two layers, deliberately separate
 *
 * **Authentication** is IAP's job and not this application's. Only the IAP service
 * agent holds `roles/run.invoker` on the service, so a request that did not come
 * through IAP never reaches this process; IAP enforces on every hostname the
 * service answers to, including the default `run.app` one. The header below is
 * therefore set by IAP and cannot be spoofed by a caller. That is a property of
 * the deployment rather than of this code.
 *
 * **Authorization** is this application's job and always will be. IAP is binary —
 * you are admitted or you are not — so "Martin may submit matchplay results but
 * may not edit courses" is not something it can express. Keeping the two apart
 * means the permission model here survives a later change of identity provider:
 * if IAP is ever pointed at Identity Platform to admit non-Google logins, IAM
 * stops being enforced and this becomes the only gate, without being rewritten.
 */

export type Permission =
    | 'events:write'
    | 'courses:write'
    | 'players:write'
    | 'matchplay:write'

export type Viewer = {
    email?: string
    authenticated: boolean
}

/** IAP prefixes the identity with its provider, e.g. `accounts.google.com:me@example.com`. */
function stripProvider(value: string): string {
    const separator = value.indexOf(':')
    return separator === -1 ? value : value.slice(separator + 1)
}

export function viewerFromHeaders(headers: Headers): Viewer {
    const raw = headers.get('x-goog-authenticated-user-email')
    if (!raw) return { authenticated: false }

    const email = stripProvider(raw).trim()
    return email ? { email, authenticated: true } : { authenticated: false }
}

/**
 * Where the sign-out link goes.
 *
 * Signing out is IAP's to do rather than this application's, for the same reason
 * signing in is: the session is a cookie IAP issued for this service, and this
 * process never sees it. `gcp-iap-mode=CLEAR_LOGIN_COOKIE` is IAP's documented
 * way to clear those cookies and send the browser back to the app, which is also
 * how a different account gets chosen — IAP asks again on the way back in.
 *
 * It clears the session with *this service*, not the Google session behind it.
 * Somebody signed into one Google account is likely to be let straight back in;
 * somebody signed into several is asked which one. Signing out of Google itself
 * is a thing only Google can offer, and this link deliberately does not pretend
 * to.
 *
 * The parameter is read by the proxy and never reaches this process, so the link
 * does nothing on a laptop, where there is no proxy in front. Nothing renders it
 * there either: without IAP's header there is no viewer to sign out.
 *
 * https://cloud.google.com/iap/docs/query-parameters-and-headers-howto
 */
export const SIGN_OUT_URL = '/?gcp-iap-mode=CLEAR_LOGIN_COOKIE'

export function can(permissions: readonly Permission[], needed: Permission): boolean {
    return permissions.includes(needed)
}
