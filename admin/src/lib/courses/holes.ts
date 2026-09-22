import type { Course } from '@hector/schemas/src/courses.ts'

/**
 * The hole descriptions, as a form can edit them: a diagram and some prose per
 * hole.
 *
 * Thirteen of the seventeen courses have them, eighteen at a time. Every one of
 * those 234 holes has a `layout` — the diagram the hole page leads with, and
 * the reason the page exists at all: it 404s without one, and
 * `descriptions.length` is what decides how many hole pages a course has. Only
 * six courses have any prose; the other seven have eighteen pictures and no
 * words.
 *
 * So the diagram is the part that must survive and the prose is the part
 * somebody is here to write, and this edits both.
 *
 * ## What it does not touch
 *
 * **`descriptions_local`** — the Finnish twin of Tahko's descriptions, 36 of
 * them, rendered nowhere on the site. Editing a second set of prose that
 * nothing displays would be a form for a field with no reader, so it is carried
 * through untouched instead and the dead field is somebody's decision to make.
 *
 * A consequence worth knowing: replacing an English diagram leaves the Finnish
 * twin pointing at the old one. They are separate arrays and always have been.
 */

/** One hole's row in the form. */
export type HoleDescriptionRow = {
    /** The hole's own number, which the form shows and never changes. */
    hole: number
    /** A diagram already committed, as `/images/...`. */
    url?: string
    /** A diagram in the asset bucket, as its object name. */
    object?: string
    /** The prose. Empty on 126 of the 270 stored descriptions. */
    text: string
}

type Description = NonNullable<NonNullable<Course['course']>['descriptions']>[number]

/** The rows a course's editor should show, in hole order. */
export function holeDescriptionRows(course: Course): HoleDescriptionRow[] {
    const descriptions = course.course?.descriptions
    if (!Array.isArray(descriptions)) return []

    return descriptions.map((hole) => ({
        hole: hole.hole,
        url: hole.layout.url,
        object: hole.layout.object,
        text: hole.description,
    }))
}

/**
 * Whether this course's diagrams are the wide kind.
 *
 * One answer for the course rather than eighteen, because that is what it is:
 * `/courses/[slug]` reads `descriptions[0].shape` and nothing else, and uses it
 * to pick the aspect of every diagram in the grid. It is stored on all eighteen
 * holes and is uniform on all four courses that set it — and the only value any
 * of them uses is `wide`.
 */
export const isWide = (course: Course): boolean => course.course?.descriptions?.[0]?.shape === 'wide'

/**
 * The hole descriptions the rows describe, written onto the stored ones.
 *
 * Built from the stored hole rather than from the row, so that anything this
 * form does not ask about survives — there is nothing else on a hole today
 * beyond `shape`, which is handled here, but the next field added to
 * `HoleDescriptionSchema` should not be deleted by an editor that predates it.
 *
 * A row whose diagram is neither chosen nor inherited keeps the stored one. The
 * schema requires a layout, so "no diagram" is not a state a hole can be in,
 * and an empty box means "unchanged" rather than "remove it".
 */
export function holeDescriptionsFrom(
    stored: Course,
    rows: readonly HoleDescriptionRow[],
    wide: boolean
): Description[] | undefined {
    const descriptions = stored.course?.descriptions
    if (!Array.isArray(descriptions)) return descriptions ?? undefined

    return descriptions.map((hole, index) => {
        const row = rows[index]
        const next: Description = {
            ...hole,
            layout: row?.object ? { object: row.object } : row?.url ? { url: row.url } : hole.layout,
            description: row ? row.text.trim() : hole.description,
        }

        // Assigned or deleted rather than spread, because `shape` is optional
        // and `{ ...hole, shape: undefined }` is a hole with the key present
        // and empty. It is on all eighteen or on none, which is how the four
        // courses that set it have always carried it.
        if (wide) next.shape = 'wide'
        else delete next.shape

        return next
    })
}
