import type { APIRoute } from 'astro'

/**
 * Liveness, for the Cloud Run startup and liveness probes in
 * `terraform/cloud_run.tf`. Touches nothing on purpose: a probe that depends on
 * Firestore turns a database blip into a restart loop, which is strictly worse
 * than a running service reporting that its database is unreachable. `/readyz`
 * is the one that checks.
 *
 * Not `/healthz`. Google's frontend reserves the internal z-page names —
 * `/healthz`, `/statusz`, `/varz`, `/rpcz` — and answers them itself with a 404
 * before the request reaches the container or even IAP. The endpoint was
 * unreachable under that name on both the run.app URL and admin.hector.golf.
 */
export const GET: APIRoute = () => new Response('ok\n', { status: 200 })
