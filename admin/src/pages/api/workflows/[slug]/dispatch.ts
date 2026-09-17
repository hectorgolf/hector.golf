import type { APIRoute } from 'astro'

import { github } from '../../../../lib/github.ts'
import { viewerFromHeaders } from '../../../../lib/identity.ts'
import { workflowBySlug } from '../../../../lib/workflows.ts'

/**
 * Start one of the data-update workflows now.
 *
 * This is the **one workflow** endpoint, behind the "Run now" buttons on
 * `/operations`: for when the data is needed between the scheduled runs, or
 * when the association published handicaps later than usual and the midday run
 * was too early to see them. The schedule calls `../dispatch` instead, which
 * starts everything at once.
 *
 * It answers a browser with a redirect and anything else with JSON, so it also
 * works from a terminal — which is the supported way to start a single workflow
 * without a browser, and why the two shapes live in one endpoint rather than
 * two that could drift apart.
 *
 * ## Who is allowed to call it
 *
 * Anybody IAP admitted, which is the same answer as for every other page here
 * and is a property of the deployment rather than of this code: only the IAP
 * service agent holds `roles/run.invoker`, so a request that did not come
 * through IAP never reaches this process, and IAP admits only principals holding
 * `roles/iap.httpsResourceAccessor`. `terraform/scheduler.tf` grants that to the
 * scheduler's service account and `terraform/iap.tf` to `var.admin_principals`.
 * Starting a scrape is the same privilege level as the rest of the admin, so
 * there is nothing finer to enforce here — see `lib/identity.ts` for where a
 * per-permission model would go if that stops being true.
 *
 * This deliberately does not require `x-goog-authenticated-user-email`. That
 * header is documented for interactive users, and whether IAP sets it for a
 * service account authenticating with an OIDC token is not; making it a
 * condition would be betting the nightly update on undocumented behaviour. It is
 * read for the log line, where being absent costs nothing.
 *
 * ## CSRF
 *
 * Astro's origin check covers the browser half: it rejects a cross-site POST
 * carrying a form content type, which is what the button sends. A caller sending
 * JSON passes it, which is what makes one endpoint work for both the button and
 * Cloud Scheduler — and is safe, because a cross-site attacker cannot make a
 * browser send that content type without CORS permission this service never
 * grants.
 *
 * The trap, for anyone adding a caller: a POST with **no** content type at all is
 * rejected too, not only a form-typed one. `astro/dist/core/app/origin-check.js`
 * reads
 *
 *     if (hasContentType) { return formLikeHeader && !isSameOrigin }
 *     return !isSameOrigin
 *
 * and curl sends no content type when it has no body. That is not a theoretical
 * trap: `.github/actions/request-deploy` was written without one and every data
 * update's deploy request returned 403 until it was given `Content-Type:
 * application/json` and an empty body, as `terraform/scheduler.tf` already did.
 */

/**
 * The `Accept` a browser sends, and Cloud Scheduler does not.
 *
 * The Operations page's script sends it too, on purpose: it takes the redirect
 * branch and follows it, so the page it lands on stays this service's decision
 * rather than something reconstructed from the JSON. See `lib/run-now.ts` before
 * "simplifying" that caller to ask for JSON instead.
 */
const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const POST: APIRoute = async ({ params, request, redirect }) => {
    const workflow = workflowBySlug(params.slug)
    if (!workflow) {
        // Not an allowlist check that happens to 404 — the allowlist *is* the
        // list of workflows this service knows about, so an unknown slug is a
        // missing route in every sense.
        return wantsHtml(request)
            ? redirect(`/operations?failed=unknown&reason=not-found`, 303)
            : json({ error: `No dispatchable workflow named ${params.slug}` }, 404)
    }

    const viewer = viewerFromHeaders(request.headers)
    // Who asked, in the log that Cloud Run collects. The scheduler shows up as
    // whatever IAP forwarded, or as "unidentified" if it forwarded nothing;
    // either way the run itself is attributable in GitHub's own history.
    console.log('Dispatching workflow', {
        workflow: workflow.file,
        by: viewer.email ?? 'unidentified caller admitted by IAP',
    })

    const outcome = await github().dispatch(workflow)

    if (wantsHtml(request)) {
        // 303 rather than 302: the browser must follow it with a GET, so a
        // reload of the page it lands on does not re-post and start a second run.
        return outcome.ok
            ? redirect(`/operations?ran=${workflow.slug}`, 303)
            : redirect(`/operations?failed=${workflow.slug}&reason=${outcome.reason}`, 303)
    }

    // 202, not 200: GitHub has accepted the request and does not say which run it
    // created, so all that is being reported is that it was asked.
    return outcome.ok
        ? json({ dispatched: workflow.file }, 202)
        : json({ error: outcome.reason, workflow: workflow.file }, 502)
}
