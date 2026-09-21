/**
 * The admin's sections, as data.
 *
 * Managing matchplay tournaments is one of several things this UI will do, so
 * the navigation is a list rather than hand-written markup: adding a section is
 * an entry here plus a folder under `src/pages/`, and nothing else moves. The
 * ones marked `planned` are deliberately visible — a nav that hides what is
 * coming makes the admin look finished when it is not.
 */

/**
 * How much of a section exists, in the three states it can be in.
 *
 * This was `available: boolean`, and two states stopped being enough the day a
 * page could show a record it cannot change. A read-only section is not "not
 * built yet" — it is there and worth opening, and a nav that said otherwise
 * would send somebody to a JSON file they did not need to open. Nor is it
 * plainly available: somebody who clicks it meaning to fix a typo should learn
 * that from the label rather than by hunting for a save button.
 *
 * Which is which is a claim about this repository, and is checked against it —
 * `test/sections.test.ts` fails if an entry here promises a page that does not
 * exist. The lie the comment above worries about is cheap to tell in either
 * direction.
 */
export type Readiness =
    /** The admin authors this: it has forms and they save. */
    | 'editable'
    /** Firestore's mirror, rendered. Edited by committing a file — see lib/mirror.ts. */
    | 'read-only'
    /** No page at all. */
    | 'planned'

export type Section = {
    /** First path segment, and the key the layout matches the current page on. */
    slug: string
    label: string
    /** One line, shown on the dashboard. */
    blurb: string
    readiness: Readiness
}

/** True if there is a page to link to, which is every state but `planned`. */
export function hasPage(section: { readiness: Readiness }): boolean {
    return section.readiness !== 'planned'
}

export const SECTIONS: Section[] = [
    {
        slug: 'events',
        label: 'Events',
        blurb: 'Every Hector, Matchplay and Finnkampen event: the field, the rounds and the results.',
        // Mixed underneath — matchplay is authored here, the other two are read —
        // and the family cards inside say which is which. A top-level section is
        // `editable` when anything under it is, because the alternative is a nav
        // entry that contradicts the page it opens.
        readiness: 'editable',
    },
    {
        slug: 'courses',
        label: 'Courses',
        blurb: 'Tees, ratings, slope and the per-hole descriptions the course guides render.',
        // In Firestore as a mirror since 2026-09-21, so there is something to
        // render. Editable is step 4 of `docs/plans/courses-in-the-admin.md`;
        // until then this is the same read-only shape players had.
        readiness: 'read-only',
    },
    {
        slug: 'players',
        label: 'Players',
        blurb: 'Profiles, biography text and the prompt hints the biography generator reads.',
        readiness: 'read-only',
    },
    {
        slug: 'operations',
        label: 'Operations',
        blurb: 'When the scrapes last ran, and a way to start one without waiting for the schedule.',
        readiness: 'editable',
    },
]

/** Which section a pathname belongs to, for marking the nav item current. */
export function sectionForPath(pathname: string): Section | undefined {
    const first = pathname.split('/').filter(Boolean)[0]
    return SECTIONS.find((s) => s.slug === first)
}

/**
 * The event formats, which are sections within Events rather than beside it.
 *
 * An event is an event whichever format it is played in — they share a schema,
 * a date range and a field — so putting Matchplay at the top level would have
 * meant Hector and Finnkampen arriving as two more top-level tabs for no reason
 * a user would recognise. Same shape as SECTIONS, and for the same reason:
 * adding Hector is an entry here plus a folder under `src/pages/events/`.
 *
 * The slug matches `EventFormat` in @hector/schemas, because the format is what
 * the distinction actually is — and `lib/mirror.ts` leans on that same
 * correspondence to decide which of these is read-only from `OWNED_FORMATS`
 * rather than from the literal below. This list is what the nav says; that set
 * is what the store will accept.
 *
 * Not every format is here. Finnkampen was, read-only, and was removed on
 * 2026-09-20 because the format is not fully implemented anywhere — the public
 * site has no route for it either, so the admin was the only place two events
 * nobody maintains were rendered. The store still holds them and
 * `listEvents()` still returns them; what is gone is the page. Step 1 of
 * `docs/plans/authoring-players-and-events.md` still nominates Finnkampen as
 * the pilot for the event editor, and that step now creates its pages rather
 * than adding a form to one.
 */
export type EventFamily = {
    slug: string
    label: string
    blurb: string
    readiness: Readiness
}

export const EVENT_FAMILIES: EventFamily[] = [
    {
        slug: 'matchplay',
        label: 'Matchplay',
        blurb: 'Create a tournament, manage its field, draw the bracket and record results.',
        readiness: 'editable',
    },
    {
        slug: 'hector',
        label: 'Hector',
        blurb: 'The main series: rounds, game formats, buckets and the courses each round is played on.',
        readiness: 'read-only',
    },
]

/**
 * Where this admin's page for an event is, or undefined when it has none.
 *
 * Derived from the list above rather than from `EventFormat`, because the two
 * stopped being the same thing when the Finnkampen pages were removed on
 * 2026-09-20: the store still holds those events and `listEvents()` still
 * returns them, so anything rendering a list of *events* can meet a format this
 * admin will not route. A link to a page that is not there is worse than a name
 * with no link, so callers get the option rather than a string.
 */
export function adminPathForEvent(event: { format: string; id: string }): string | undefined {
    const family = EVENT_FAMILIES.find((f) => f.slug === event.format)
    return family && hasPage(family) ? `/events/${family.slug}/${event.id}` : undefined
}
