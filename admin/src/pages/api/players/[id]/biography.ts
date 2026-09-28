import type { APIRoute } from 'astro'

import { viewerFromHeaders } from '../../../../lib/identity.ts'
import { execute, runNeverStarted } from '../../../../lib/jobs/execute.ts'
import { biographiesForPlayer } from '../../../../lib/jobs/registry.ts'
import { getPlayer } from '../../../../lib/repository/events.ts'

/**
 * Draft a biography for one player, now.
 *
 * The narrow door beside `../../jobs/[slug]/run.ts`'s wide one. That endpoint
 * runs the sweep — every unlocked player of the upcoming Hector, forty-five
 * model calls — which is the only thing there was, and the wrong thing to reach
 * for when one paragraph reads badly. This runs the same job for one named
 * player, through the same `execute`, so it takes the same lease and lands in
 * the same run log; a draft made here and a sweep cannot interleave over the
 * `biographyDrafts` collection.
 *
 * Everything about who may call it is a property of the deployment rather than
 * of this code, and is described at length in the sibling endpoint: only the IAP
 * service agent holds `roles/run.invoker`, so a request that did not come
 * through IAP never reaches this process.
 *
 * ## Why it answers slowly, and why that is fine here
 *
 * One model call, held open for its duration, for the reason the sibling gives:
 * `cpu_idle = true` means there is no background half to hand the work to. That
 * is seconds rather than the sweep's minutes, which is the whole point — but it
 * is still long enough that the button pressing it disables itself.
 *
 * ## Where it sends a browser
 *
 * To the drafts page on success, because that is where the thing it just made
 * is, and back to the player on anything else, because that is where the button
 * was and where the sentence explaining it belongs. The reason travels as a
 * short code rather than a sentence: the sentence is in the run log, which
 * `/operations` renders in full, and a query parameter is a poor place for prose
 * somebody might paste.
 *
 * ## CSRF
 *
 * The same trap as every other POST here, and worth repeating because it has
 * cost this repository a day: Astro's origin check rejects a cross-site POST
 * that arrives with *no* content type at all, not only one carrying a form
 * content type. `curl` sends none when it has no body. Callers send
 * `Content-Type: application/json` and `--data '{}'`.
 */

const wantsHtml = (request: Request) => (request.headers.get('accept') ?? '').includes('text/html')

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const POST: APIRoute = async ({ params, request, redirect }) => {
    const id = params.id
    /*
     * Checked here rather than left to the job, which reports an unknown player
     * as a failed run. It is not one: nothing went wrong with generating
     * anything, the caller named somebody who is not there, and recording that
     * in the run log would put a red entry on /operations for a bad URL.
     */
    const player = id ? await getPlayer(id) : undefined
    if (!player) {
        // 404 to a browser too, the same as `/players/[id]` gives for the same
        // URL. There is no page to redirect to that would say anything truer.
        return wantsHtml(request)
            ? new Response('Player not found', { status: 404 })
            : json({ error: `No player with id ${id}` }, 404)
    }

    const viewer = viewerFromHeaders(request.headers)
    const result = await execute(biographiesForPlayer(player.id), viewer.email ?? 'unidentified caller admitted by IAP')

    const back = (reason: string) => redirect(`/players/${player.id}?draft=${reason}`, 303)

    if (runNeverStarted(result)) {
        // The same two, told apart the same way: a lease collision is transient
        // and the sweep it is waiting on will finish, a missing credential is
        // permanent until somebody sets one. See the sibling endpoint.
        const notConfigured = result.skipped === 'not-configured'
        return wantsHtml(request)
            ? back(notConfigured ? 'not-configured' : 'busy')
            : json(
                  { skipped: player.id, because: result.skipped, heldBy: result.heldBy, detail: result.detail },
                  notConfigured ? 503 : 409
              )
    }

    if (result.outcome === 'failed') {
        return wantsHtml(request) ? back('failed') : json({ error: result.detail ?? 'the job failed' }, 502)
    }

    /*
     * A run that happened and declined to write: no key for the biography
     * function, or players not owned yet. Told apart from a success because the
     * page must not send somebody to a drafts list that has nothing new in it.
     */
    if (result.outcome === 'skipped') {
        return wantsHtml(request) ? back('declined') : json({ skipped: player.id, detail: result.detail }, 200)
    }

    // 303 so a reload of the page it lands on does not start a second run — and
    // a second model call.
    return wantsHtml(request)
        ? redirect(`/players/biographies?drafted=${encodeURIComponent(player.id)}`, 303)
        : json({ drafted: player.id, outcome: result.outcome, detail: result.detail, changes: result.changes }, 200)
}
