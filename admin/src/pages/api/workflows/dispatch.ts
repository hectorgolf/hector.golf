import type { APIRoute } from 'astro'

import { github } from '../../../lib/github.ts'
import { viewerFromHeaders } from '../../../lib/identity.ts'
import { execute } from '../../../lib/jobs/execute.ts'
import { SCHEDULED_JOBS } from '../../../lib/jobs/registry.ts'
import { SCHEDULED_WORKFLOWS } from '../../../lib/workflows.ts'

/**
 * Start everything the schedule is responsible for: the endpoint the two Cloud
 * Scheduler jobs call: hourly from 03:00 to 07:00 UTC, and once at 12:00 UTC.
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
 * ## It also runs this service's own jobs
 *
 * Two lists, one tick: the GitHub workflows in `workflows.ts` and the in-process
 * jobs in `jobs/registry.ts`. A dataset moves from the first list to the second
 * as it migrates — `docs/plans/handicaps-to-firestore.md` — and during the
 * migration it is briefly in both, which is the point rather than a mistake.
 *
 * **Workflows are dispatched first, jobs second, and the order is load-bearing
 * in two directions.**
 *
 * A dispatch is two API calls that return in milliseconds; a job is a 45-player
 * scrape. Dispatching first keeps the promptness this whole mechanism exists to
 * buy — GitHub's own schedule delivery runs hours late, which is the problem
 * being solved — and means a job that hangs cannot stop the workflows starting.
 *
 * It also makes the shadow comparison mean something. The handicaps job reads
 * `handicaps.json` at the start of its run, seconds after the dispatch and
 * minutes before `update-handicaps.yml` commits anything. So both pipelines
 * decide against the *same* base state, and their answers are directly
 * comparable. Running the job first, or on a schedule of its own an hour later,
 * would have the job read a file the workflow had already updated — and it would
 * agree with the workflow by construction, having been told the answer.
 *
 * ## A failing job does not fail the tick
 *
 * Deliberately, and it is the one place this endpoint treats its two lists
 * differently. A failed *dispatch* returns 502 so Cloud Scheduler retries, which
 * is cheap and idempotent enough. A failed *job* is reported in the body and in
 * the run log, and the tick still returns success.
 *
 * Otherwise a job that is broken for a boring reason — no WiseGolf credentials
 * on a fresh project, say — would fail every tick, and every retry would
 * re-dispatch the workflows that had already succeeded and re-run the scrape.
 * Four sweeps of somebody else's API per tick, to retry something a retry cannot
 * fix. The next tick is the retry, and there are six a day.
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

    // Then this service's own jobs, sequentially: they share a Cloud Run
    // instance with one CPU, and two scrapes in parallel would contend for it
    // while making the logs of both harder to read.
    const jobs = []
    for (const job of SCHEDULED_JOBS) {
        jobs.push(await execute(job, viewer.email ?? 'the schedule'))
    }

    if (wantsHtml(request)) {
        // Reported as one workflow when one failed, so the Operations page can
        // say something specific; "some of them" is not a useful notice.
        return failures.length === 0
            ? redirect('/operations?ran=scheduled', 303)
            : redirect(`/operations?failed=${failures[0]!.slug}&reason=${failures[0]!.reason}`, 303)
    }

    return new Response(JSON.stringify({ dispatched: results, jobs }), {
        // The status reports the dispatches only. A failed job is in the body —
        // see the note above on why it must not make the scheduler retry.
        status: failures.length === 0 ? 202 : 502,
        headers: { 'content-type': 'application/json' },
    })
}
