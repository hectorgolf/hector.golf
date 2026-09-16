import type { APIRoute } from 'astro'

import { snapshot } from '../../../lib/data/snapshot.ts'
import { viewerFromHeaders } from '../../../lib/identity.ts'

/**
 * The data the public site is built from.
 *
 * Called once per build by `astrosite/src/code/data-source.ts`, authenticated
 * the way every other caller here is: an ID token for the IAP audience, minted
 * through Workload Identity Federation by the deploy workflow. Nothing about the
 * authorisation is special-cased for it — only the IAP service agent holds
 * `roles/run.invoker`, so a request that did not come through IAP never reaches
 * this process.
 *
 * ## It is a GET, and that is not an oversight
 *
 * Every other endpoint here is a POST, because every other endpoint does
 * something. This one only reads, so the CSRF reasoning that makes the others
 * insist on a JSON content type does not apply — Astro's origin check only
 * guards unsafe methods.
 *
 * ## No caching header
 *
 * Deliberately. The build asks for this exactly once, and the only other caller
 * is a person with `curl` trying to find out what the build saw. A cache between
 * those two would exist solely to make the second answer wrong.
 *
 * ## What it does not do
 *
 * It does not filter by what the site happens to render today. The payload is
 * the data, and deciding which fields matter is the site's job — which is what
 * lets the course files keep the Finnish hole descriptions nothing reads yet.
 */
export const GET: APIRoute = async ({ request }) => {
    const viewer = viewerFromHeaders(request.headers)
    console.log('Serving a data snapshot', { to: viewer.email ?? 'unidentified caller admitted by IAP' })

    try {
        const payload = await snapshot()
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    } catch (error) {
        // The build treats any non-200 as fatal when it has credentials, which is
        // the point: a site deploy must not quietly publish yesterday's data
        // because Firestore was briefly unreachable.
        console.error('Could not assemble the data snapshot', error)
        return new Response(JSON.stringify({ error: 'could not read the data' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
        })
    }
}
