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

export function can(permissions: readonly Permission[], needed: Permission): boolean {
    return permissions.includes(needed)
}
