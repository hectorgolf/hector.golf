import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EventFormat } from '@hector/schemas/src/events.ts'

import { COURSES_ARE_OWNED, OWNED_FORMATS, PLAYERS_ARE_OWNED } from '../src/lib/ownership.ts'
import { EVENT_FAMILIES, SECTIONS, adminPathForEvent, hasPage, sectionForPath } from '../src/lib/sections.ts'

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

    /**
     * The claim the filesystem cannot check, and the one that went stale.
     *
     * A section's page exists whether or not it can be saved, so the two tests
     * above pass happily while the dashboard offers a `Read-only` pill on a
     * section with a Save button — which is what it did from the players flip on
     * 2026-09-21 until this was written. `sections.ts` derives these two from the
     * flags for that reason, and this is the guard against somebody writing the
     * word back in.
     *
     * Only the two single-collection sections are checked. Events is mixed
     * underneath and says so in its own comment; Operations owns nothing.
     */
    it('calls a collection editable only where the store would accept a write', () => {
        const owned: Record<string, boolean> = { courses: COURSES_ARE_OWNED, players: PLAYERS_ARE_OWNED }
        for (const section of SECTIONS.filter((s) => s.slug in owned)) {
            expect(section.readiness === 'editable', `${section.slug} is ${section.readiness}`).toBe(
                owned[section.slug]
            )
        }
    })

    it('matches a pathname to the section it belongs to', () => {
        expect(sectionForPath('/players/lasse-k')?.slug).toBe('players')
        expect(sectionForPath('/events/hector/HECTOR2025')?.slug).toBe('events')
        expect(sectionForPath('/nothing-here')).toBeUndefined()
    })
})

/**
 * Every family's slug is a format, and `lib/mirror.ts` relies on it: it decides
 * whether a family is read-only by asking `OWNED_FORMATS` about that slug. A
 * family whose slug is not a format would get no notice at all and look
 * editable, which is the one failure the notice exists to prevent.
 *
 * A subset, not a bijection — which it was until the Finnkampen pages were
 * removed on 2026-09-20. `adminPathForEvent` is what the rest of the admin uses
 * to cope with the difference, so its two answers are worth pinning here.
 */
describe('the event families and the formats', () => {
    it('name only real formats, and none of them twice', () => {
        const slugs = EVENT_FAMILIES.map((f) => f.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
        for (const slug of slugs) {
            expect(Object.values(EventFormat) as string[]).toContain(slug)
        }
    })

    it('call a family editable only where the store would accept a write', () => {
        for (const family of EVENT_FAMILIES) {
            const owned = OWNED_FORMATS.has(family.slug as EventFormat)
            expect(family.readiness === 'editable', `${family.slug} is ${family.readiness}`).toBe(owned)
        }
    })

    it('give a path for a format this admin routes', () => {
        expect(adminPathForEvent({ format: EventFormat.Hector, id: 'HECTOR2025' })).toBe(
            '/events/hector/HECTOR2025'
        )
    })

    /**
     * The store still holds Finnkampen events and `listEvents()` still returns
     * them, so a page listing events across formats can be handed one. Answering
     * a path would send somebody to a 404.
     */
    it('give none for a format it does not, rather than a link that 404s', () => {
        expect(
            adminPathForEvent({ format: EventFormat.Finnkampen, id: 'FINNKAMPEN2022' })
        ).toBeUndefined()
    })
})
