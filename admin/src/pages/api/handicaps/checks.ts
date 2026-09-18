import type { APIRoute } from 'astro'

import { all, render } from '../../../lib/handicaps/checks.ts'

/**
 * The sweep log, as the site builds from it.
 *
 * The sibling of `history.ts`, deliberately identical in shape: same NDJSON, same
 * `no-store`, same silence about why a failure happened. Two endpoints rather
 * than one carrying both logs, because the site asks for them at different
 * moments and for different reasons — `handicaps.ts` wants the readings and
 * `handicap-checks.ts` wants the sweeps — and a combined payload would make
 * either reader depend on the other's shape.
 *
 * What this log answers, which the observation log cannot: *when did we last
 * look*. A player whose handicap has not moved since August has no observation
 * to cite, and "we checked at 03:02 this morning and it is still 15.4" is the
 * sentence the events page needs. It reaches app.hector.golf through
 * `/events/hector/:id/handicaps.json`, so the numbers here are a published
 * contract rather than an internal detail.
 *
 * Who may call it is the same answer as everywhere else in this service and is a
 * property of the deployment rather than of this code: only the IAP service
 * agent holds `roles/run.invoker`, and IAP admits only principals holding
 * `roles/iap.httpsResourceAccessor`.
 */

/**
 * The `Accept` a browser sends and a build does not.
 *
 * `handicap-checks.ts` in the site asks for `application/x-ndjson` explicitly.
 */
const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

export const GET: APIRoute = async ({ request }) => {
    try {
        const checks = await all()
        return new Response(render(checks), {
            status: 200,
            headers: {
                'content-type': wantsHtml(request)
                    ? 'text/plain; charset=utf-8'
                    : 'application/x-ndjson; charset=utf-8',
                // A cached answer here dates a handicap to the wrong sweep, which
                // is the one thing this log exists to get right.
                'cache-control': 'no-store',
            },
        })
    } catch (error) {
        console.error('Could not read the handicap sweep log', error)
        return new Response('Could not read the handicap sweep log.\n', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
    }
}
