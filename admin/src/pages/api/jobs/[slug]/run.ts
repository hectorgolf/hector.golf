import type { APIRoute } from 'astro'

import { viewerFromHeaders } from '../../../../lib/identity.ts'
import { execute } from '../../../../lib/jobs/execute.ts'
import { jobBySlug } from '../../../../lib/jobs/registry.ts'

/**
 * Run one of this service's own data jobs, now.
 *
 * The counterpart to `../../workflows/[slug]/dispatch.ts`: that one asks GitHub
 * to run a workflow and returns as soon as GitHub accepts, this one does the
 * work in the request. The schedule does not call this — it calls
 * `../../workflows/dispatch`, which runs every job marked `scheduled` alongside
 * the workflows. This is the "run one now" door, and both go through
 * `lib/jobs/execute.ts` so that a run started here and one started by the tick
 * contend for the same lease. Everything about who may call it is the same, and is a
 * property of the deployment rather than of this code — only the IAP service
 * agent holds `roles/run.invoker`, so a request that did not come through IAP
 * never reaches this process, and IAP admits only principals holding
 * `roles/iap.httpsResourceAccessor`. `terraform/scheduler.tf` grants that to the
 * scheduler's service account and `terraform/iap.tf` to `var.admin_principals`.
 *
 * There is deliberately no API key. One would be checked by nothing here and
 * would not get a caller past IAP in any case.
 *
 * ## Why it answers slowly
 *
 * A sweep of 45 players plus two GitHub round trips takes tens of seconds, and
 * this holds the request open for all of it. The alternative — answer 202 and
 * finish in the background — does not work on this deployment: `cpu_idle = true`
 * in `terraform/cloud_run.tf` means CPU is throttled once the response is sent,
 * so the background half would run at a crawl or not at all.
 *
 * That makes two timeouts load-bearing, and they are set in Terraform rather
 * than here: the Cloud Run request timeout, and the calling Cloud Scheduler
 * job's `attempt_deadline`. The scheduler's default of 120s is *not* enough, and
 * a deadline shorter than the job does not cancel the run — it just starts
 * another one on top of it, which is what the lease below is for.
 *
 * ## CSRF
 *
 * The same trap as the dispatch endpoint, and worth repeating because it has
 * already cost a day once: Astro's origin check rejects a cross-site POST that
 * arrives with *no* content type at all, not only one carrying a form content
 * type. `curl` sends none when it has no body. Callers send
 * `Content-Type: application/json` and `--data '{}'`.
 */

const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const POST: APIRoute = async ({ params, request, redirect }) => {
    const job = jobBySlug(params.slug)
    if (!job) {
        return wantsHtml(request)
            ? redirect(`/operations?failed=unknown&reason=not-found`, 303)
            : json({ error: `No job named ${params.slug}` }, 404)
    }

    const viewer = viewerFromHeaders(request.headers)
    const result = await execute(job, viewer.email ?? 'unidentified caller admitted by IAP')

    if (result.outcome === 'skipped') {
        // 409, and not a retry-worthy status. A run that arrives while another
        // is going should be dropped rather than queued: the next tick is an
        // hour away at most and will read the same sources.
        return wantsHtml(request)
            ? redirect(`/operations?failed=${job.slug}&reason=already-running`, 303)
            : json({ skipped: job.slug, heldBy: result.heldBy, detail: result.detail }, 409)
    }

    if (wantsHtml(request)) {
        // 303 so a reload of the page it lands on does not start a second run.
        return result.outcome === 'ok'
            ? redirect(`/operations?ran=${job.slug}`, 303)
            : redirect(`/operations?failed=${job.slug}&reason=job-failed`, 303)
    }

    // 200 rather than 202: unlike a dispatch, the work is done by the time this
    // is written, and the body says what it did.
    return result.outcome === 'ok'
        ? json({ ran: job.slug, dryRun: job.dryRun, changes: result.changes, commit: result.commit }, 200)
        : json({ error: result.detail ?? 'the job failed', job: job.slug }, 502)
}
