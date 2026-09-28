import { defineMiddleware } from 'astro:middleware'

import { mayServe, servesFullSurface } from './lib/surface.ts'

/**
 * The first thing every request meets, and on the hooks service the only thing
 * standing between the internet and the admin UI.
 *
 * All of the reasoning is in `lib/surface.ts`. This is deliberately the whole of
 * the middleware: one decision, taken before anything else runs, with no branch
 * that can reach a page. Adding a second concern here — logging that reads a
 * body, a header rewrite, anything with a `try` in it — is how an early `return`
 * ends up above the check.
 *
 * 404 rather than 403, and not as a security-by-obscurity flourish: on this
 * deployment those routes genuinely are not there. A 403 would be a claim that
 * the caller could have them with better credentials, which is false — no
 * credential reaches the admin UI through this hostname.
 */
export const onRequest = defineMiddleware((context, next) => {
    if (mayServe(context.url.pathname, servesFullSurface())) return next()

    // Logged, because the useful case is somebody wondering why a page they
    // just added answers 404 on one service and works on the other. The path is
    // safe to log: it is what the caller sent, and nothing here reads a query
    // string or a body.
    console.warn('Refusing a path this deployment does not serve', { path: context.url.pathname })

    return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
})
