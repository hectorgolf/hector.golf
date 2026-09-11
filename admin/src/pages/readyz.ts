import type { APIRoute } from 'astro'

import { checkFirestore } from '../lib/firestore'

/** Readiness: does depend on Firestore, and says 503 when it cannot reach it. */
export const GET: APIRoute = async () => {
    const status = await checkFirestore()
    return new Response(JSON.stringify(status), {
        status: status.reachable ? 200 : 503,
        headers: { 'content-type': 'application/json' },
    })
}
