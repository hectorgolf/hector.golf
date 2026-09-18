import type { APIRoute } from 'astro'

import { all, render } from '../../../lib/handicaps/observations.ts'

/**
 * The handicap observation log, as the site builds from it.
 *
 * Step 3 of `docs/plans/handicaps-to-firestore.md`: the reader moves here, once,
 * rather than to the committed NDJSON and off it again later. A backup that is
 * also the build input is not a backup — it is the production path under a
 * misleading name — so the site asks this and keeps the committed file for the
 * builds that cannot.
 *
 * ## Why NDJSON rather than JSON
 *
 * Byte-for-byte what `data/handicaps/observations.ndjson` holds, because the
 * caller has to accept both and two formats would mean two parsers kept in step
 * by hand. It also makes the fallback comparable to the live answer with `diff`
 * when somebody is trying to work out which one a build used.
 *
 * ## Who may call it
 *
 * Nothing here, which is the same answer as every other route in this service
 * and is a property of the deployment rather than of this code: only the IAP
 * service agent holds `roles/run.invoker`, so a request that did not come
 * through IAP never reaches this process, and IAP admits only principals holding
 * `roles/iap.httpsResourceAccessor`. The site build gets in the way
 * `.github/actions/request-deploy` does — Workload Identity Federation, then an
 * ID token for the IAP audience.
 *
 * This is the first route that is read-only and safe to call repeatedly, and it
 * is worth saying that nothing about that changes the above. It is not public
 * because the history is secret — it is committed to a public repository — but
 * because IAP is in front of the whole service and there is no exception
 * mechanism worth building for one endpoint.
 */

/** A full scan of the collection, which is what rendering the log requires. */
export const GET: APIRoute = async () => {
    try {
        const entries = await all()
        return new Response(render(entries), {
            status: 200,
            headers: {
                // `application/x-ndjson` is the registered type. The charset is
                // not part of it, so it is stated: `render` writes UTF-8 and a
                // reader that guesses Latin-1 would mangle nothing today and a
                // player's name tomorrow.
                'content-type': 'application/x-ndjson; charset=utf-8',
                // Never a cached answer. A build asking for this wants what
                // Firestore holds now, and the one failure this route can cause
                // — publishing yesterday's handicaps as though they were
                // today's — is precisely what a cache in between would produce.
                'cache-control': 'no-store',
            },
        })
    } catch (error) {
        // Logged rather than returned. Response bodies are assumed public here,
        // the way `GitHubFailure` in `lib/github.ts` explains, and a Firestore
        // error carries project and collection detail.
        console.error('Could not read the handicap observation log', error)
        return new Response('Could not read the handicap observation log.\n', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
    }
}
