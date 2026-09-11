/**
 * Who is making this request.
 *
 * ## The trust boundary
 *
 * This service never authenticates anyone. Two things in front of it do:
 *
 * 1. **Cloud Run IAM.** Only the IAP service agent holds `roles/run.invoker` on
 *    the service (see `terraform/iap.tf`), so a request that did not come through
 *    IAP is refused before it reaches this process.
 * 2. **IAP.** It enforces on every hostname the service answers to, including the
 *    default `run.app` URL, and admits only the principals granted
 *    `roles/iap.httpsResourceAccessor` — the `admin_principals` variable.
 *
 * So the headers below are set by IAP and cannot be spoofed by a caller. That is
 * a statement about the deployment, not about this code: run this process with
 * anything else in front of it and the headers mean nothing.
 *
 * The stronger check is to verify the signed JWT in `x-goog-iap-jwt-assertion`
 * against Google's public keys, with the audience
 * `/projects/<PROJECT_NUMBER>/global/backendServices/<SERVICE_ID>`. It is worth
 * adding when this service starts accepting writes; it is deliberately not here
 * yet, because a half-implemented signature check reads as more assurance than it
 * gives.
 */

export type Viewer = {
    /** The signed-in address, or undefined when running outside IAP. */
    email?: string;
    /** True when IAP supplied an identity, i.e. this is a real deployment. */
    authenticated: boolean;
};

/** IAP prefixes the identity with its provider, e.g. `accounts.google.com:me@example.com`. */
function stripProvider(value: string): string {
    const separator = value.indexOf(":");
    return separator === -1 ? value : value.slice(separator + 1);
}

export function viewerFromHeaders(headers: Headers): Viewer {
    const raw = headers.get("x-goog-authenticated-user-email");
    if (!raw) return { authenticated: false };

    const email = stripProvider(raw).trim();
    return email ? { email, authenticated: true } : { authenticated: false };
}
