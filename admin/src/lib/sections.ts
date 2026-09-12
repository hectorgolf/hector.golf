/**
 * The admin's sections, as data.
 *
 * Managing matchplay tournaments is one of several things this UI will do, so
 * the navigation is a list rather than hand-written markup: adding a section is
 * an entry here plus a folder under `src/pages/`, and nothing else moves. The
 * ones marked `available: false` are deliberately visible — a nav that hides
 * what is coming makes the admin look finished when it is not.
 */
export type Section = {
    /** First path segment, and the key the layout matches the current page on. */
    slug: string
    label: string
    /** One line, shown on the dashboard. */
    blurb: string
    available: boolean
}

export const SECTIONS: Section[] = [
    {
        slug: 'events',
        label: 'Events',
        blurb: 'Every Hector, Matchplay and Finnkampen event: the field, the rounds and the results.',
        available: true,
    },
    {
        slug: 'courses',
        label: 'Courses',
        blurb: 'Tees, ratings, slope and the per-hole descriptions the course guides render.',
        available: false,
    },
    {
        slug: 'players',
        label: 'Players',
        blurb: 'Profiles, biography text and the prompt hints the biography generator reads.',
        available: false,
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
 * the distinction actually is.
 */
export type EventFamily = {
    slug: string
    label: string
    blurb: string
    available: boolean
}

export const EVENT_FAMILIES: EventFamily[] = [
    {
        slug: 'matchplay',
        label: 'Matchplay',
        blurb: 'Create a tournament, manage its field, draw the bracket and record results.',
        available: true,
    },
    {
        slug: 'hector',
        label: 'Hector',
        blurb: 'The main series: rounds, game formats, buckets and the courses each round is played on.',
        available: false,
    },
    {
        slug: 'finnkampen',
        label: 'Finnkampen',
        blurb: 'Finland against Sweden: teams, rounds and results.',
        available: false,
    },
]
