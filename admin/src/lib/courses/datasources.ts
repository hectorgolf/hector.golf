import type { Course } from '@hector/schemas/src/courses.ts'

/**
 * Where a course's numbers came from, as a form can edit them.
 *
 * A datasource is a `{ name, url }` pair, and across the 17 courses the names
 * come from a very short list while the URLs are all different — every course
 * has a `website` and an `mscorecard`, eight have an `official scorecard`, and
 * the rest appear once or twice. So the name is a vocabulary and the URL is the
 * content, which is what this file's shape follows from.
 *
 * ## Why a row per name rather than a checkbox per name
 *
 * A checkbox cannot say where the PDF is. Ticking "official scorecard" leaves
 * the one thing that makes it a source unanswered, and a second field to fill
 * in after ticking is a row with extra steps.
 *
 * So: one labelled row per name, each with a URL box. Filled means the course
 * has that source; empty means it does not. The vocabulary stays closed, nobody
 * types a name, and "remove this source" is clearing a box.
 *
 * ## Nothing a course already has is ever dropped
 *
 * A name outside the list still gets a row, because `courseFromForm` overwrites
 * `datasources` with what the form carried. A row this file declined to render
 * would be a source deleted by opening the editor and pressing Save — silently,
 * and only for the courses unlucky enough to have one.
 *
 * ## Order is preserved, so a save that changes nothing changes nothing
 *
 * The rows are the course's own sources in their stored order, then the unused
 * names. Rebuilding in vocabulary order instead would reorder the JSON of every
 * course somebody edits, and the export would commit that as a diff nobody
 * asked for.
 */

/**
 * The names in use across the committed courses, most common first.
 *
 * A list somebody maintains, not a rule: the schema allows any name, and a
 * course carrying one that is not here still shows it and still saves it. Add
 * to this when a new kind of source turns up more than once.
 *
 * `slope table` and `official slope table` look like the same thing spelled two
 * ways — one course uses each. Both are here because both are in the data;
 * merging them is a data decision, not an editor one.
 */
export const KNOWN_DATASOURCES = [
    'website',
    'mscorecard',
    'official scorecard',
    'slope table',
    'local rules',
    'official slope table',
    'top100golfcourses',
] as const

/** One row: a name that cannot be edited, and a URL that can. */
export type DatasourceRow = {
    name: string
    url: string
    /** True for a name this course does not use — rendered, just empty. */
    unused: boolean
}

/**
 * The rows a course's editor should show: what it has, then what it could have.
 *
 * Its own sources come first and in their own order, so a course that is saved
 * without anybody touching this section comes back byte-identical.
 */
export function datasourceRows(course: Course): DatasourceRow[] {
    const mine = course.datasources.map((source) => ({ name: source.name, url: source.url, unused: false }))
    const taken = new Set(mine.map((row) => row.name))
    const rest = KNOWN_DATASOURCES.filter((name) => !taken.has(name)).map((name) => ({ name, url: '', unused: true }))
    return [...mine, ...rest]
}

/**
 * The sources the rows describe: the filled ones, in the order they appear.
 *
 * A blank URL is not a source. That is the whole of "remove this one" — there
 * is no separate control for it, because a source with nowhere to point is not
 * a thing the record can hold.
 */
export function datasourcesFrom(rows: readonly DatasourceRow[]): Course['datasources'] {
    return rows
        .filter((row) => row.url.trim() !== '')
        .map((row) => ({ name: row.name.trim(), url: row.url.trim() }))
}
