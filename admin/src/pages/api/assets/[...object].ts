import type { APIRoute } from 'astro'

import { assetBucket, getAsset } from '../../../lib/assets.ts'

/**
 * Shows an uploaded image that has not been published yet.
 *
 * Without this the course editor can preview a *committed* image — the public
 * site serves those — and shows a blank square for one somebody has just
 * uploaded, which is precisely the moment they want to look at it. An image
 * editor that cannot show you the image you chose is not one.
 *
 * ## Who may read it
 *
 * The same people who may read anything else here, by the same mechanism: only
 * the IAP service agent holds `roles/run.invoker`, so a request that did not
 * come through IAP never reaches this process. There is no second check here
 * and there should not be — a bespoke one would be a second answer to a
 * question `terraform/iap.tf` already answers for every route.
 *
 * The object name comes out of the URL, so it is the one thing here that a
 * caller controls. It is used to name an object in one bucket and nothing else:
 * there is no path join, so `..` is a character in an object name rather than a
 * traversal, and the bucket holds only what this service has uploaded.
 */

export const prerender = false

const CACHE = 'private, max-age=300'

export const GET: APIRoute = async ({ params }) => {
    const object = params.object
    if (!object) return new Response('Not found', { status: 404 })

    if (!assetBucket) {
        // Normal on a laptop. The editor already says uploading is unavailable;
        // this keeps a preview from looking like a broken deployment.
        return new Response('No asset bucket is configured.', { status: 503 })
    }

    try {
        const bytes = await getAsset(object)
        return new Response(new Uint8Array(bytes), {
            status: 200,
            headers: {
                // Guessed from the name rather than stored: the bucket only ever
                // holds what `IMAGE_TYPES` allows, and the name ends in the
                // extension that list chose.
                'content-type': contentTypeOf(object),
                'cache-control': CACHE,
            },
        })
    } catch {
        // A reference whose object has gone is a real state — an upload that
        // failed halfway, a bucket emptied by hand — and the page renders it as
        // a missing image rather than failing to render at all.
        return new Response('Not found', { status: 404 })
    }
}

function contentTypeOf(object: string): string {
    const extension = object.split('.').pop()?.toLowerCase()
    return extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : extension === 'avif'
            ? 'image/avif'
            : 'image/jpeg'
}
