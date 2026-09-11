import type { APIRoute } from 'astro'

/**
 * Liveness. Touches nothing on purpose: a probe that depends on Firestore turns
 * a database blip into a restart loop, which is strictly worse than a running
 * service reporting that its database is unreachable. `/readyz` is the one that
 * checks.
 */
export const GET: APIRoute = () => new Response('ok\n', { status: 200 })
