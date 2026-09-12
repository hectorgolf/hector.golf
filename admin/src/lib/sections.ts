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
        slug: 'matchplay',
        label: 'Matchplay',
        blurb: 'Create a tournament, manage its field, draw the bracket and record results.',
        available: true,
    },
    {
        slug: 'events',
        label: 'Events',
        blurb: 'Hector and Finnkampen events: rounds, game formats and the courses they are played on.',
        available: false,
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
