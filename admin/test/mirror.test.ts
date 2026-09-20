import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'

import { eventMirror } from '../src/lib/mirror.ts'
import { MIRRORED_FORMATS, OWNED_FORMATS } from '../src/lib/ownership.ts'

/**
 * The notice that says a page has no save button, and why.
 *
 * The property worth holding is that it is derived rather than listed: the
 * change that makes a format authorable is the change that removes its notice.
 * A second list would leave a page apologising for a limitation that had been
 * lifted, which is the same class of stale claim as a nav entry promising a page
 * that does not exist.
 */
describe('why a record is read-only', () => {
    it('says nothing about a format the admin authors', () => {
        for (const format of OWNED_FORMATS) {
            expect(eventMirror(format)).toBeUndefined()
        }
    })

    it('explains every format the admin only mirrors, so none renders bare', () => {
        for (const format of MIRRORED_FORMATS) {
            const mirror = eventMirror(format)
            expect(mirror, `no mirror described for ${format}`).toBeDefined()
            expect(mirror?.authoredAt).toContain(format)
        }
    })

    /**
     * One, not two. `update-handicaps.yml` wrote `event.buckets` until the admin's
     * own handicaps job took the recompute over and the workflow was deleted on
     * 2026-09-20 — so the notice would be overstating the price if it still named
     * it, and the page would be telling somebody to wait for a move that has
     * happened.
     */
    it('names the one job that still has to move before a Hector can be authored', () => {
        const mirror = eventMirror(EventFormat.Hector)
        expect(mirror?.scheduledWriters).toEqual(['update-leaderboards (results.teams)'])
    })

    /**
     * The useful accident the authoring plan's ordering rests on: Finnkampen has
     * no scheduled writer, so it is the collection whose flip costs a list entry
     * and nothing else. The page says so rather than implying a price it does not
     * have.
     */
    it('has no writers to move for Finnkampen, which is why it goes first', () => {
        expect(eventMirror(EventFormat.Finnkampen)?.scheduledWriters).toEqual([])
    })

    /**
     * Players had a `PLAYER_MIRROR` here until 2026-09-21, because they have no
     * `OWNED_FORMATS` entry to be absent from — the property above could not
     * derive their answer, so it was written down. It went with the flip, and
     * the check that it went is the one below: the module exports mirrors for
     * event formats and nothing else, so a player page cannot render a notice
     * apologising for a limitation that has been lifted.
     */
    it('has nothing left to say about players, who are authored here now', async () => {
        const mirror = await import('../src/lib/mirror.ts')
        expect(Object.keys(mirror)).not.toContain('PLAYER_MIRROR')
    })
})
