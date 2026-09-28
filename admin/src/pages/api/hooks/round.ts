import type { APIRoute } from 'astro'

import { attribution, keyMatches, readSignal } from '../../../lib/hooks/round.ts'
import { execute, runNeverStarted } from '../../../lib/jobs/execute.ts'
import { jobBySlug } from '../../../lib/jobs/registry.ts'
import { hooksApiKey } from '../../../lib/secrets.ts'

/**
 * Where app.hector.golf says a round has started or ended.
 *
 * It answers on `hooks.hector.golf` and nowhere else: this is the one route
 * `lib/surface.ts` lets a restricted deployment serve, and on the admin service
 * — which is behind IAP — it is unreachable by anything that could present a
 * key. Read that module first; the reason this endpoint is not on
 * `admin.hector.golf` is the whole of its design.
 *
 * ## Why the admin wants to know
 *
 * Because nothing here can work it out. A Hector's rounds carry a `day` and a
 * `round` number and no times at all — see `hectorRoundSchema` — so the admin's
 * sharpest idea of "the state of play changed" is a date boundary:
 * `eventDatesPassedSince` deploys the site at an event's start, at each midnight
 * during it, and at its end. That is the right backstop and a poor substitute
 * for the thing itself. The last putt of round three drops at 16:40 and the
 * board should say so at 16:41, not at midnight.
 *
 * app.hector.golf is the only system that knows. This is where it tells us.
 *
 * ## What it does
 *
 * Runs the `leaderboards` job, now, in the request — the same job the tick runs
 * and the same one the relay function asks for. There is deliberately no second
 * code path: a signal that arrives by a different door must produce the same
 * commit as the tick would, or the two disagree and only one of them is tested.
 *
 * A deploy follows when the job changes something, and does not when it does
 * not. That falls out of how the job already works rather than being decided
 * here: it commits under `astrosite/`, which `deploy-site.yml` watches, so a
 * changed board publishes itself and an unchanged one costs nothing. Forcing a
 * build at every boundary was considered and is the wrong default — most
 * boundaries change a board that the next page load would have shown anyway.
 *
 * ## Why every phase does the same thing today
 *
 * `round-started`, `round-ended` and `event-ended` all run the same job, and
 * that is a finding rather than an omission: refreshing the published board is
 * the correct response to each of them, and nothing else the admin can do is
 * specific to one. What differs is the run log, which says which it was.
 *
 * The phase is in the contract anyway, because the alternative — one
 * undifferentiated "poke" — cannot grow. The day event-ended should also freeze
 * something, or round-started should reset a cache, the caller is already
 * telling us which moment this is, and that day needs a change here rather than
 * a change on their side.
 *
 * ## CSRF
 *
 * Astro's origin check rejects a cross-site POST that arrives with no content
 * type at all, not only one carrying a form content type. Callers send
 * `Content-Type: application/json`. The same trap as every other POST endpoint
 * in this service, and it has cost a day once already — see
 * `api/jobs/[slug]/run.ts`.
 */

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })

export const POST: APIRoute = async ({ request }) => {
    /*
     * The key is checked before the body is read, and before anything else is
     * looked at. This endpoint is reachable by anyone, so every branch above the
     * check is a fact a stranger can learn — including, if the order were
     * reversed, which payloads this service considers well formed.
     *
     * A missing key is the one thing that cannot wait behind the check, because
     * without it nobody can be authenticated at all. It is 503 rather than 500:
     * the fix is a setup step somebody has to take — `gcloud secrets versions
     * add` — not an incident, and `terraform/secrets.tf` creates the container
     * deliberately empty.
     */
    const expected = await hooksApiKey()
    if (!expected) {
        console.error('The round hook has no key configured, so it can admit nobody')
        return json({ error: 'not_configured' }, 503)
    }

    const presented = request.headers.get('x-api-key')
    if (!presented || !keyMatches(presented, expected)) {
        // No detail, and no distinction between absent and wrong.
        console.warn('Refused a round hook request presenting no valid key')
        return json({ error: 'unauthorized' }, 401)
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return json({ error: 'bad_request', detail: 'expected a JSON body' }, 400)
    }

    const read = readSignal(body)
    if (!read.ok) {
        // Said back to the caller, unlike everything above the key check: this
        // one has authenticated, and a 400 it cannot diagnose is an integration
        // nobody can finish.
        console.warn('Refused a round hook signal this service does not understand', { detail: read.detail })
        return json({ error: 'bad_request', detail: read.detail }, 400)
    }

    const job = jobBySlug('leaderboards')
    if (!job) {
        // The list is a constant in this repository, so this cannot happen
        // without somebody renaming the entry — which is exactly when a silent
        // pass would be worst, because the symptom is a board that stops moving.
        console.error('No leaderboards job for the round hook to run')
        return json({ error: 'no_such_job' }, 500)
    }

    const result = await execute(job, attribution(read.signal))

    if (runNeverStarted(result)) {
        /*
         * Two ways a run can not happen, and they want opposite things said, as
         * in `api/jobs/[slug]/run.ts`.
         *
         * A lease collision is 409 and is the *expected* answer to a busy
         * afternoon: two rounds ending within seconds of each other produce one
         * run and one refusal, and the refusal is correct — the run that is
         * already going reads the same upstream and publishes the same board.
         * The caller should drop it rather than retry.
         */
        const notConfigured = result.skipped === 'not-configured'
        return json(
            { skipped: job.slug, phase: read.signal.phase, because: result.skipped, detail: result.detail },
            notConfigured ? 503 : 409
        )
    }

    if (result.outcome === 'failed') {
        return json({ error: result.detail ?? 'the job failed', job: job.slug, phase: read.signal.phase }, 502)
    }

    return json(
        {
            ran: job.slug,
            phase: read.signal.phase,
            outcome: result.outcome,
            detail: result.detail,
            changes: result.changes,
            commit: result.commit,
        },
        200
    )
}
