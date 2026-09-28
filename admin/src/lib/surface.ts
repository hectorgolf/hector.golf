/**
 * Which of this image's routes a given deployment is allowed to serve.
 *
 * ## Why one image serves two services
 *
 * `admin.hector.golf` is behind IAP, and IAP on Cloud Run is a property of the
 * *service*: it admits or refuses, for every path, on every hostname the service
 * answers to. There is no per-path exemption, which is why an endpoint
 * authenticated by an API key cannot live on that hostname — IAP would turn
 * app.hector.golf away before any header of ours was read.
 *
 * So the webhook lives on a second Cloud Run service, `hooks.hector.golf`, with
 * IAP off and the key checked in the application. It runs the same container,
 * because the work it triggers is the admin's work: the same jobs, the same
 * lease, the same run log, the same Firestore. A separate program would either
 * duplicate all of that or call back into the admin through IAP, which is the
 * relay we already have and the hop this design exists to remove.
 *
 * ## What that costs, and what pays for it
 *
 * Running the admin's image with no IAP in front of it means the only thing
 * between the public internet and the whole admin UI is this module. The pages
 * do not defend themselves: `identity.ts` says in its first paragraph that
 * authentication is IAP's job and not this application's, and it is right about
 * the service it was written for — but on the hooks service there is no IAP, so
 * an unauthenticated request reaching a page would be served one.
 *
 * Three properties are what make that safe, and all three are tested:
 *
 * **Deny by default.** A restricted deployment serves the paths on one short
 * list and answers 404 to everything else. Not "refuse the dangerous ones" —
 * there is no list of dangerous paths to get wrong, and a route added next month
 * is refused without anybody remembering this file exists.
 *
 * **Restricted is the default.** The full surface is opt-in, declared by the
 * admin service in `terraform/cloud_run.tf`. A deployment that loses its
 * configuration, or a third service somebody adds in a hurry, is restricted
 * rather than open. The safe state is the one you get by doing nothing.
 *
 * **The allowlist is exact.** Whole paths, compared with `===`, not prefixes and
 * not patterns. A prefix match on `/api/hooks` would also serve
 * `/api/hooks/../../players`, and while the URL parser normalises that away
 * today, a rule that depends on somebody else's normalisation is a rule that
 * breaks quietly.
 */

/**
 * The paths a restricted deployment serves.
 *
 * `/livez` is here because Cloud Run's startup and liveness probes need it, and
 * it touches nothing — see the probe comments in `terraform/cloud_run.tf`.
 * `/readyz` is deliberately *not*: it reaches Firestore, and whether this
 * project's database is answering is not a thing to tell the internet.
 */
export const PUBLIC_PATHS: readonly string[] = ['/livez', '/api/hooks/round']

/**
 * Whether this process serves the whole admin.
 *
 * Opt-in, and read at call time rather than captured at module load so a test
 * can set it. `import.meta.env.DEV` keeps `npm run dev` serving everything: a
 * laptop has no IAP either, and a dev server that 404s its own pages would be
 * a daily cost paid for a production property.
 */
export function servesFullSurface(
    environment: { ADMIN_SURFACE?: string } = process.env,
    isDev: boolean = import.meta.env?.DEV === true
): boolean {
    return isDev || environment.ADMIN_SURFACE === 'full'
}

/**
 * Whether a restricted deployment may serve this path.
 *
 * Takes the pathname alone — not the request — because that is the whole of the
 * decision, and a function that cannot see the method or the headers cannot be
 * talked into making an exception for one.
 */
export function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.includes(pathname)
}

/**
 * The verdict for one request, as the middleware applies it.
 *
 * Returned as a value rather than acted on here so that the table of what is
 * and is not served can be asserted directly, without a server.
 */
export function mayServe(pathname: string, fullSurface: boolean): boolean {
    return fullSurface || isPublicPath(pathname)
}
