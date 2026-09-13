import type { APIRoute } from 'astro'

import { github } from '../../../lib/github.ts'
import { viewerFromHeaders } from '../../../lib/identity.ts'
import { SCHEDULED_WORKFLOWS } from '../../../lib/workflows.ts'

/**
 * Start everything the schedule is responsible for: the endpoint the two Cloud
 * Scheduler jobs call, at 03:00 and 12:00 UTC.
 *
 * ## Why one endpoint rather than a job per workflow
 *
 * Cloud Scheduler bills per job per month and the first three on a billing
 * account are free, so a job per workflow puts this project over a threshold it
 * otherwise sits under — against a budget of about a euro. Two jobs that each
 * say "run the scheduled updates" stay inside it, and have the better property
 * anyway: *what* runs at 03:00 is a list in `workflows.ts` that a reader can see
 * in one place, rather than something to be reconstructed from job names in a
 * console.
 *
 * What is deliberately **not** moved into code is *when*. The times live in
 * `terraform/scheduler.tf`, where `gcloud scheduler jobs list` can answer them
 * without reading TypeScript — which matters more than usual here, given this
 * whole mechanism exists because nobody could tell when a job really ran.
 *
 * ## Partial failure
 *
 * A fan-out has an outcome per workflow and one status code to say it in. This
 * reports 502 if any dispatch failed, which makes Cloud Scheduler retry the
 * whole tick and re-dispatch the ones that worked. That is the right trade here:
 * a duplicate run is cheap — a repeated handicap reading is kept as another
 * reading rather than corrupting the first, `latestPerDay` decides which one
 * counts, and the shared GitHub concurrency group keeps two runs from
 * overlapping — while a silently skipped workflow is the failure this service
 * was built to stop. The body names each workflow and its outcome, so the logs
 * say which half actually failed.
 *
 * See `[slug]/dispatch.ts` for the single-workflow endpoint behind the buttons,
 * and for the note on who is allowed to call either of these.
 */

const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

export const POST: APIRoute = async ({ request, redirect }) => {
    const viewer = viewerFromHeaders(request.headers)
    console.log('Dispatching the scheduled workflows', {
        workflows: SCHEDULED_WORKFLOWS.map((workflow) => workflow.file),
        by: viewer.email ?? 'unidentified caller admitted by IAP',
    })

    // Sequentially, not in parallel. These are dispatches rather than runs, so
    // the ordering GitHub sees is the order they queue in, and the concurrency
    // group then runs them in that order. Two calls to GitHub is not a latency
    // problem worth trading that away for.
    const results: Array<{ slug: string; ok: boolean; reason?: string }> = []
    for (const workflow of SCHEDULED_WORKFLOWS) {
        const outcome = await github().dispatch(workflow)
        results.push(outcome.ok ? { slug: workflow.slug, ok: true } : { slug: workflow.slug, ok: false, reason: outcome.reason })
    }

    const failures = results.filter((result) => !result.ok)

    if (wantsHtml(request)) {
        // Reported as one workflow when one failed, so the Operations page can
        // say something specific; "some of them" is not a useful notice.
        return failures.length === 0
            ? redirect('/operations?ran=scheduled', 303)
            : redirect(`/operations?failed=${failures[0]!.slug}&reason=${failures[0]!.reason}`, 303)
    }

    return new Response(JSON.stringify({ dispatched: results }), {
        status: failures.length === 0 ? 202 : 502,
        headers: { 'content-type': 'application/json' },
    })
}
