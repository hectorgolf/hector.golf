import type { Course } from '@hector/schemas/src/courses.ts'

/**
 * What a course is on the day somebody makes one.
 *
 * Until now courses arrived by import and the editor only ever changed one that
 * already existed. The difference that matters is not the form — it is that
 * everything the editor edits has to be *there* to be edited:
 *
 * - `description_long`, `datasources` and `images` are containers the editor
 *   adds to, so they start empty rather than absent.
 * - **`course` has to exist**, even with no tees and no lengths in it.
 *   `courseFromForm` returns early when it does not, which means a course
 *   created without one could never gain a tee or a scorecard through the
 *   editor — it would take the typing and save nothing, which is this form's
 *   oldest mistake wearing new clothes.
 *
 * So a new course is scaffolded with its holes, and the editor takes over from
 * a page that has something on it.
 */

/** Lowercase, digits and hyphens: what all seventeen existing ids are made of. */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The most common par, and therefore the one to start eighteen holes at.
 *
 * 156 of the 293 committed holes are par 4 — 53%, against 72 threes, 64 fives
 * and a single six. Somebody typing a real card will change roughly half of
 * them, which beats typing all of them.
 */
export const DEFAULT_PAR = 4

/** What the courses have: nine, fourteen and eighteen all occur. */
export const DEFAULT_HOLES = 18
export const MAX_HOLES = 18

export type NewCourseForm = {
    id: string
    name: string
    homepage: string
    address: string
    descriptionShort: string
    holes: string
}

export const BLANK_NEW_COURSE: NewCourseForm = {
    id: '',
    name: '',
    homepage: '',
    address: '',
    descriptionShort: '',
    holes: String(DEFAULT_HOLES),
}

/**
 * What is wrong with the form, in the order somebody reading it would notice.
 *
 * Only the things the schema cannot say for itself. It refuses a bad URL and an
 * empty name on its own; what it has no opinion about is whether an id is
 * shaped like the other seventeen, and it cannot know whether one is taken —
 * which is the answer that matters most here, because `saveCourse` writes with
 * `set` and would overwrite a course rather than refuse.
 */
export function problemsWith(form: NewCourseForm, taken: boolean): string[] {
    const problems: string[] = []
    const id = form.id.trim()

    if (id === '') problems.push('An id is needed: it is the filename and the address on the public site.')
    else if (!ID.test(id))
        problems.push(
            `"${id}" cannot be an id. Lowercase letters, digits and single hyphens between them — like "konopiste-radecky".`
        )
    else if (taken) problems.push(`There is already a course called "${id}". Ids are permanent, so pick another.`)

    const holes = Number(form.holes.trim())
    if (!Number.isInteger(holes) || holes < 1 || holes > MAX_HOLES)
        problems.push(`A course has between 1 and ${MAX_HOLES} holes, not "${form.holes}".`)

    return problems
}

/**
 * A suggestion for the id, from the name.
 *
 * A suggestion and not a rule: the seventeen that exist are not slugs of their
 * names — "Diamond Country Club - Park" is `diamondcc-park`, which nothing
 * mechanical would produce. Somebody who knows the club picks a better one than
 * this, and the box is theirs to overwrite.
 */
export function suggestId(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

/**
 * The course the form describes: enough of a record to be valid, and enough of
 * a scaffold to be worth opening the editor on.
 *
 * The holes are numbered from one, every par is the commonest one, and the
 * stroke indexes are `1..n` — a permutation, which is what the schema wants,
 * and obviously a placeholder, which is what somebody retyping a real card
 * wants to see.
 */
export function newCourseFrom(form: NewCourseForm): Course {
    const holes = Number(form.holes.trim())

    return {
        id: form.id.trim(),
        name: form.name.trim(),
        homepage: form.homepage.trim(),
        contact: { address: form.address.trim() },
        description_short: form.descriptionShort.trim(),
        description_long: [],
        images: {},
        datasources: [],
        course: {
            tees: [],
            scorecard: {
                men: Array.from({ length: holes }, (_, index) => ({
                    hole: index + 1,
                    par: DEFAULT_PAR,
                    hcp: index + 1,
                    lengths: {},
                })),
                ladies: null,
            },
        },
    } as Course
}
