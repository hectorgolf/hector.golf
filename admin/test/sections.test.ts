import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'

import { OWNED_FORMATS } from '../src/lib/ownership.ts'
import { EVENT_FAMILIES, SECTIONS, hasPage, sectionForPath } from '../src/lib/sections.ts'

/**
 * The navigation makes two claims and this checks both, because both are the
 * same kind of lie and neither fails anywhere else.
 *
 * `sections.ts` says a nav that hides what is coming makes the admin look
 * finished when it is not. The other direction arrived with the read-only pages:
 * an entry that says a page exists sends somebody to a 404, and an entry that
 * says one does not sends them to a JSON file they did not need to open. A
 * string in a list has no compiler to answer to, so the filesystem answers
 * instead.
 */

const pages = join(dirname(fileURLToPath(import.meta.url)), '../src/pages')

/** A section has a page if its folder has an index, or if it is a single file. */
const pageExistsAt = (path: string): boolean =>
    existsSync(join(pages, path, 'index.astro')) || existsSync(join(pages, `${path}.astro`))

describe('what the navigation promises', () => {
    /*
     * Looped inside one test rather than spread over `it.each`, because either
     * list is allowed to become empty — the day Courses is built there is no
     * `planned` section left — and `it.each([])` is a failing suite rather than a
     * passing one with nothing to do.
     */
    it('has a page for every section it offers as a link', () => {
        for (const section of SECTIONS.filter(hasPage)) {
            expect(pageExistsAt(section.slug), `${section.slug} is ${section.readiness}`).toBe(true)
        }
    })

    it('has no page for a section it calls planned, which is why it is not a link', () => {
        for (const section of SECTIONS.filter((s) => !hasPage(s))) {
            expect(pageExistsAt(section.slug), `${section.slug} is ${section.readiness}`).toBe(false)
        }
    })

    it('has a page for every event family it offers as a link', () => {
        for (const family of EVENT_FAMILIES.filter(hasPage)) {
            expect(pageExistsAt(join('events', family.slug)), family.slug).toBe(true)
        }
    })

    it('matches a pathname to the section it belongs to', () => {
        expect(sectionForPath('/players/lasse-k')?.slug).toBe('players')
        expect(sectionForPath('/events/hector/HECTOR2025')?.slug).toBe('events')
        expect(sectionForPath('/nothing-here')).toBeUndefined()
    })
})

/**
 * The families are the event formats, and `lib/mirror.ts` relies on that: it
 * decides which family is read-only by asking `OWNED_FORMATS` about the slug. A
 * family whose slug is not a format would get no notice at all and look
 * editable, which is the one failure the notice exists to prevent.
 */
describe('the event families and the formats', () => {
    it('name every format exactly once, so none is unreachable', () => {
        expect(EVENT_FAMILIES.map((f) => f.slug).sort()).toEqual(Object.values(EventFormat).sort())
    })

    it('call a family editable only where the store would accept a write', () => {
        for (const family of EVENT_FAMILIES) {
            const owned = OWNED_FORMATS.has(family.slug as EventFormat)
            expect(family.readiness === 'editable', `${family.slug} is ${family.readiness}`).toBe(owned)
        }
    })
})
