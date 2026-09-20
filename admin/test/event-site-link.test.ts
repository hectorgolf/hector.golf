import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'

import { SITE_ORIGIN, siteVisibility } from '../src/lib/events/site.ts'

/**
 * "Shown on the site" is a link when the answer is yes, so the answer has to be
 * right in a way it did not before. A wrong "No" is a small lie; a wrong "Yes"
 * is a 404 with the admin's name on it.
 */
const event = (format: EventFormat, ignore: boolean, id = 'HECTOR2025') => ({ id, format, ignore })

describe('whether the public site has a page for an event', () => {
    it('links a Hector event to the page the site builds for it', () => {
        expect(siteVisibility(event(EventFormat.Hector, false))).toEqual({
            shown: true,
            url: `${SITE_ORIGIN}/events/hector/HECTOR2025/`,
        })
    })

    it('links a matchplay tournament the same way', () => {
        expect(siteVisibility(event(EventFormat.Matchplay, false, 'HECTORMATCHPLAY2026'))).toEqual({
            shown: true,
            url: `${SITE_ORIGIN}/events/matchplay/HECTORMATCHPLAY2026/`,
        })
    })

    /**
     * The path is `linkToEvent()`'s in `astrosite/src/code/events.ts`, and the
     * slug is the event id verbatim — `getStaticPaths` in `[slug].astro` maps
     * `getAllEventIds()` straight onto `params.slug`, with no slugifying in
     * between. Pinned because the admin cannot import either function, so
     * nothing else would notice the day one of them changed.
     *
     * The trailing slash is the one deliberate difference; the comment on
     * `siteVisibility` says why. Checked against the live site on 2026-09-20:
     * without it, `https://hector.golf/events/hector/HECTOR2025` answers 301 to
     * the slashed form, which then answers 200.
     */
    it('builds the path the site actually serves, id and all', () => {
        const visibility = siteVisibility(event(EventFormat.Hector, false, 'HECTOR2026'))
        expect(visibility.shown && visibility.url).toBe('https://hector.golf/events/hector/HECTOR2026/')
    })

    it('says no, and why, for an event the ignore flag hides', () => {
        expect(siteVisibility(event(EventFormat.Hector, true))).toEqual({
            shown: false,
            reason: 'ignored',
        })
    })

    /**
     * The case this function exists for. Both committed Finnkampen events carry
     * `ignore: true`, so today the two reasons agree — but clearing that flag is
     * one keystroke, and reading `ignore` alone would then offer a link to a page
     * the site has no route to build.
     */
    it('says no for Finnkampen even with the ignore flag clear, there being no route', () => {
        expect(siteVisibility(event(EventFormat.Finnkampen, false, 'FINNKAMPEN2022'))).toEqual({
            shown: false,
            reason: 'no-route',
        })
    })

    it('blames the missing route rather than the flag when both apply', () => {
        expect(siteVisibility(event(EventFormat.Finnkampen, true, 'FINNKAMPEN2022'))).toEqual({
            shown: false,
            reason: 'no-route',
        })
    })
})
