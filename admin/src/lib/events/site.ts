import { EventFormat, type Event } from '@hector/schemas/src/events.ts'

/**
 * Whether the public site has a page for this event, and where.
 *
 * "Shown on the site" used to be read off `ignore` alone, which is the flag the
 * build filters on — `getAllEvents` in `astrosite/src/code/events.ts` drops an
 * ignored event and `getEventById` refuses one. That is necessary and not
 * sufficient: a page also needs a route to be built into, and one format does
 * not have one.
 *
 * **Finnkampen has no `/events/finnkampen/` route.** `architecture.md` §13
 * records it — `EventList.astro` warns and skips those events, and the site's own
 * `linkToEvent()` produces a dead URL for them. So a Finnkampen event is not on
 * the site whatever `ignore` says.
 *
 * No page in this admin renders a Finnkampen event any more, so that branch is
 * unreached today. It is still the rule, `EventDetailsView` still takes a
 * `genericEventSchema` event, and the check is one `Set.has` — cheap insurance
 * against a field that would otherwise answer "Yes" and link to a 404 the first
 * time a page is pointed at one.
 *
 * The path is `linkToEvent()`'s, `/events/{format}/{id}`, kept as a literal here
 * rather than imported: that function lives in `astrosite/src/code/events.ts`,
 * which globs the filesystem at module scope and cannot be imported by this
 * service at all. `event-site-link.test.ts` pins the shape.
 */

/** Where the public site is served. `astrosite/astro.config.mjs` sets the same. */
export const SITE_ORIGIN = 'https://hector.golf'

/**
 * The formats `astrosite/src/pages/events/` has a `[slug].astro` for.
 *
 * A list rather than a check, because the admin cannot see the site's routes.
 * If a Finnkampen route is ever added, this is the one line that changes.
 */
const FORMATS_WITH_A_PUBLIC_PAGE: ReadonlySet<EventFormat> = new Set([
    EventFormat.Hector,
    EventFormat.Matchplay,
])

export type SiteVisibility =
    | { shown: true; url: string }
    /** `ignored`: the flag is set. `no-route`: the site cannot build a page for this format. */
    | { shown: false; reason: 'ignored' | 'no-route' }

export function siteVisibility(event: Pick<Event, 'id' | 'format' | 'ignore'>): SiteVisibility {
    // Asked before `ignore`, because it is the binding constraint: clearing the
    // flag on a Finnkampen event still produces no page, and a reason that
    // implies otherwise would send somebody to edit the wrong thing.
    if (!FORMATS_WITH_A_PUBLIC_PAGE.has(event.format)) return { shown: false, reason: 'no-route' }
    if (event.ignore) return { shown: false, reason: 'ignored' }
    // Trailing slash, which `linkToEvent()` omits and this cannot afford to.
    // The site builds `build.format: 'directory'` — the default — so the page is
    // `.../HECTOR2025/index.html` and the host 301s the slashless form onto the
    // slashed one. Inside the site that redirect is invisible; from an absolute
    // link it is a wasted round trip on every click.
    return { shown: true, url: `${SITE_ORIGIN}/events/${event.format}/${event.id}/` }
}
