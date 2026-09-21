/**
 * Where an image in a course description can be looked at from inside the
 * admin.
 *
 * Two sources, because there are two kinds of image and the admin serves
 * neither of them by accident. An **uploaded** one is an object in the asset
 * bucket and is public nowhere, so it comes back through this service's own
 * route. A **committed** one is already on the public site, and the admin does
 * not serve the site's files — pointing an `img` at `part.url` directly renders
 * a broken square, which is what the editor's first cut did.
 *
 * Shared rather than written out twice: the editor and the course page both
 * show these, and the failure mode of getting it wrong is an image that is
 * simply missing, which nothing warns about.
 */

/** The site whose `/images/...` paths a committed image refers to. */
const PUBLIC_SITE = 'https://hector.golf'

/** An image entry from `description_long`, as much of it as this needs. */
type Image = { url?: string; object?: string }

/**
 * What to put in `src`, or `undefined` for an image row that has neither yet —
 * the state a blank row in the editor is in.
 *
 * The object wins when both are set, which is what makes replacing a published
 * image show the new one rather than the one still on the site.
 */
export const previewSrc = (part: Image): string | undefined =>
    part.object ? `/api/assets/${part.object}` : part.url ? `${PUBLIC_SITE}${part.url}` : undefined
