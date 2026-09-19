import type { APIRoute } from 'astro'

import { due } from '../../../lib/cadence.ts'
import { github } from '../../../lib/github.ts'
import { viewerFromHeaders } from '../../../lib/identity.ts'
import { execute } from '../../../lib/jobs/execute.ts'
import { SCHEDULED_JOBS } from '../../../lib/jobs/registry.ts'
import { DISPATCHABLE_WORKFLOWS, SCHEDULED_WORKFLOWS } from '../../../lib/workflows.ts'
import { SEED_PAGES, sync } from '../../../lib/workflow-runs.ts'

/**
 * Start everything the schedule is responsible for: the endpoint the two Cloud
 * Scheduler jobs call: every two hours from 03:00 to 07:00 UTC, and once at
 * 12:00 UTC.
 *
 * ## It is the only clock
 *
 * The workflows no longer carry `schedule:` crons. They did until 2026-09-16,
 * as a backstop, and the backstop cost more than it bought: two clocks per
 * workflow, one of them hours late, and duplicate runs that had to be explained
 * every time somebody read the Actions tab. This tick is now the only thing that
 * starts a scheduled workflow, which also means a Cloud Scheduler or admin
 * outage stops all of them — deliberately chosen, with the trade understood.
 *
 * Not everything here runs on every tick. `SCHEDULED_WORKFLOWS` is what the tick
 * *considers*; `lib/cadence.ts` decides which of them are due, by asking GitHub
 * when each last ran. That is what lets a fortnightly job share a tick with a
 * four-times-daily one without a second Cloud Scheduler job.
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
 * as it migrates, and during the migration it is briefly in both — which is the
 * point rather than a mistake. Handicaps made that move and is now only a job;
 * the three scrapes still on the first list are the ones left.
 *
 * **Workflows are dispatched first, jobs second, and the order is load-bearing.**
 *
 * A dispatch is two API calls that return in milliseconds; a job is a 45-player
 * scrape. Dispatching first keeps the promptness this whole mechanism exists to
 * buy — GitHub's own schedule delivery runs hours late, which is the problem
 * being solved — and means a job that hangs cannot stop the workflows starting.
 *
 * It mattered a second way while a dataset was in both lists: the job read the
 * workflow's committed file seconds after the dispatch and minutes before the
 * workflow rewrote it, so the two decided against the same base state and their
 * answers could be compared. That is how the handicaps job was proved before the
 * workflow was deleted, and it is how the next one will be.
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
 * fix. The next tick is the retry, and there are four a day.
 *
 * ## It is also what keeps the run archive complete
 *
 * The tick mirrors GitHub's run history into Firestore afterwards — see
 * `lib/workflow-runs.ts`. The Operations page does the same on every visit, so
 * most of the time this finds nothing new, and that is the point of doing it
 * here too: GitHub deletes runs after 90 days, and an archive that is only
 * topped up when somebody happens to open a page is an archive with holes in it
 * for exactly the weeks nobody was watching.
 *
 * It is also the only caller with the budget to *seed* a workflow it has never
 * seen, which is a walk back through everything GitHub still holds. A page
 * render is somebody waiting; a tick is not.
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
    const now = new Date()
    const results: Array<{ slug: string; ok: boolean; skipped?: true; because?: string; reason?: string }> = []

    for (const workflow of SCHEDULED_WORKFLOWS) {
        // Only the interval-scheduled ones cost a call. `'tick'` is due by
        // definition, and asking GitHub about it every tick would be a request
        // per workflow per tick to learn nothing.
        const latest =
            workflow.cadence === 'tick'
                ? undefined
                : await github()
                      .recentRuns(workflow, 1)
                      // `null` is "could not read", which `due` treats differently
                      // from "has never run" — see the note there on why an
                      // unreadable history must not dispatch.
                      .then((outcome) => (outcome.ok ? outcome.runs[0] : null))

        const verdict = due(workflow.cadence, latest, now)
        if (!verdict.due) {
            console.log('Not due on this tick', { workflow: workflow.file, because: verdict.because })
            results.push({ slug: workflow.slug, ok: true, skipped: true, because: verdict.because })
            continue
        }

        const outcome = await github().dispatch(workflow)
        results.push(
            outcome.ok
                ? { slug: workflow.slug, ok: true, because: verdict.because }
                : { slug: workflow.slug, ok: false, reason: outcome.reason }
        )
    }

    const failures = results.filter((result) => !result.ok)

    // Then this service's own jobs, sequentially: they share a Cloud Run
    // instance with one CPU, and two scrapes in parallel would contend for it
    // while making the logs of both harder to read.
    const jobs = []
    for (const job of SCHEDULED_JOBS) {
        jobs.push(await execute(job, viewer.email ?? 'the schedule'))
    }

    /*
     * Last, and over every workflow rather than only the scheduled ones: a run
     * started by a button or by a scrape asking for a deploy belongs in the
     * archive as much as a scheduled one does.
     *
     * After the jobs rather than straight after the dispatches, because by then a
     * minute or so has passed and the runs this tick started are visible to
     * GitHub's list — so they are mirrored on this tick rather than on the next
     * one. It never throws and its failures do not fail the tick: the dispatches
     * are what Cloud Scheduler retries for, and re-dispatching four workflows
     * because a mirror could not be written would be a poor trade.
     */
    const mirrored = await sync(DISPATCHABLE_WORKFLOWS, { maxPages: SEED_PAGES })
    if (mirrored.failures.length > 0) {
        console.warn('Could not fully mirror the workflow run history', { failures: mirrored.failures })
    }

    if (wantsHtml(request)) {
        // Reported as one workflow when one failed, so the Operations page can
        // say something specific; "some of them" is not a useful notice.
        return failures.length === 0
            ? redirect('/operations?ran=scheduled', 303)
            : redirect(`/operations?failed=${failures[0]!.slug}&reason=${failures[0]!.reason}`, 303)
    }

    return new Response(JSON.stringify({ dispatched: results, jobs, mirrored }), {
        // The status reports the dispatches only. A failed job is in the body —
        // see the note above on why it must not make the scheduler retry.
        status: failures.length === 0 ? 202 : 502,
        headers: { 'content-type': 'application/json' },
    })
}
