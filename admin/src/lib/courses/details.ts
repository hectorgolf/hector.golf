import { applyTeeEdits, type Course, type CourseTee } from '@hector/schemas/src/courses.ts'

/**
 * What a person writes on a golf course, read off a submitted form.
 *
 * Four groups: identity, contact, the prose, and the tees. What is *not* here is
 * the larger half of the record, and each omission is deliberate rather than
 * unfinished:
 *
 * - **The scorecard.** Eighteen holes of par, stroke index and a length per tee
 *   is around 130 numbers that come off an official card, not out of somebody's
 *   head. A form for them would be a transcription exercise with no proofreader.
 * - **Hole descriptions.** Prose, eighteen at a time and in two languages for
 *   the Tahko courses. Worth an editor; worth its own one.
 * - **Images and `datasources`.** Paths and provenance. Nothing has asked.
 * - **`id`.** The document key, the filename and the course's address on the
 *   public site.
 *
 * Everything omitted is carried through untouched, which is the property that
 * matters: this builds a whole `Course` from the stored one and overwrites only
 * what the form carried.
 */

/** The boxes, flat, as a form gives them back. */
export type CourseForm = {
    name: string
    homepage: string
    address: string
    phone: string
    email: string
    descriptionShort: string
    /** The long description, in the order the boxes are in. */
    description: DescriptionRow[]
    tees: TeeForm[]
}

/**
 * One row of the long description: a paragraph or an image, plus what the form
 * lets somebody do to it.
 *
 * Ordering is a number somebody types rather than buttons that move a row,
 * because moving a row means a round trip per move and a page that has to
 * remember unsaved edits across each one. Typing `1` next to the last paragraph
 * says the same thing in one submit, and works with no script at all — which is
 * how the rest of this admin's forms work.
 */
export type DescriptionRow = {
    kind: 'paragraph' | 'image'
    /** Paragraph text. Empty for an image row. */
    content: string
    /** An image already committed, as `/images/...`. */
    url?: string
    /** An image in the asset bucket, as its object name. */
    object?: string
    /** Where this row should end up. Sorted on, not trusted to be sequential. */
    position: string
    /** Ticked to drop this row. */
    remove: boolean
}

export type TeeForm = {
    /** Absent for the blank row, which is how a tee is added. */
    id?: string
    name: string
    nameLocal: string
    color: string
    length: string
    par: string
    parLadies: string
    ratingMen: string
    ratingLadies: string
    slopeMen: string
    slopeLadies: string
}

const teeOf = (tee: CourseTee): TeeForm => ({
    id: tee.id,
    name: tee.name,
    nameLocal: tee.name_local ?? '',
    color: tee.color,
    length: String(tee.length),
    par: String(tee.par),
    parLadies: tee.par_ladies === undefined ? '' : String(tee.par_ladies),
    ratingMen: tee.rating.men === null ? '' : String(tee.rating.men),
    ratingLadies: tee.rating.ladies === null ? '' : String(tee.rating.ladies),
    slopeMen: tee.slope.men === null ? '' : String(tee.slope.men),
    slopeLadies: tee.slope.ladies === null ? '' : String(tee.slope.ladies),
})

/** The blank row every form ends with, which is how a tee gets added. */
export const BLANK_TEE: TeeForm = {
    name: '',
    nameLocal: '',
    color: '#ffffff',
    length: '',
    par: '',
    parLadies: '',
    ratingMen: '',
    ratingLadies: '',
    slopeMen: '',
    slopeLadies: '',
}

/** A row per description entry, in the order the record has them. */
const descriptionOf = (course: Course): DescriptionRow[] =>
    course.description_long.map((part, index) => ({
        kind: part.type,
        content: part.type === 'paragraph' ? (part.content ?? '') : '',
        url: part.type === 'image' ? part.url : undefined,
        object: part.type === 'image' ? part.object : undefined,
        position: String(index + 1),
        remove: false,
    }))

/** The stored course as the boxes should first show it. */
export function formOf(course: Course): CourseForm {
    return {
        name: course.name,
        homepage: course.homepage,
        address: course.contact.address,
        phone: course.contact.phone ?? '',
        email: course.contact.email ?? '',
        descriptionShort: course.description_short,
        description: descriptionOf(course),
        tees: [...(course.course?.tees ?? []).map(teeOf), { ...BLANK_TEE }],
    }
}

/**
 * A number, or `undefined` for an empty box and `NaN` for something that is not
 * one.
 *
 * `NaN` rather than `undefined` for a typo, so the schema refuses it and the
 * page says so. Coercing it to "not set" would discard what somebody typed and
 * report a successful save, which is the one outcome they cannot detect.
 */
const optionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : Number(trimmed)
}

/** The same, for the fields whose absence the schema spells `null`. */
const nullableNumber = (value: string): number | null => {
    const trimmed = value.trim()
    return trimmed === '' ? null : Number(trimmed)
}

/**
 * The tees a form describes, with the blank row dropped.
 *
 * A row is blank when its name is — that is the only field always present on a
 * real tee. It is how a tee is added without script: the form always renders one
 * more row than there are tees, and an untouched one is ignored.
 *
 * Removing a tee is *not* expressible here, deliberately. It would drop that
 * tee's column from the scorecard, and a form where clearing a name deletes
 * measurements is a form that deletes measurements by accident.
 * `applyTeeEdits` supports it for when there is a considered way to ask.
 */
export function teesFrom(rows: readonly TeeForm[]): CourseTee[] {
    return rows
        .filter((row) => row.name.trim() !== '')
        .map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            name: row.name.trim(),
            ...(row.nameLocal.trim() ? { name_local: row.nameLocal.trim() } : {}),
            color: row.color.trim(),
            length: optionalNumber(row.length) ?? NaN,
            par: optionalNumber(row.par) ?? NaN,
            ...(row.parLadies.trim() ? { par_ladies: optionalNumber(row.parLadies)! } : {}),
            rating: { men: nullableNumber(row.ratingMen), ladies: nullableNumber(row.ratingLadies) },
            slope: { men: nullableNumber(row.slopeMen), ladies: nullableNumber(row.slopeLadies) },
        })) as CourseTee[]
}

/**
 * The rows, plus one empty paragraph and one empty image row at the end.
 *
 * How a description item gets added without script, and the same trick the tee
 * table uses: the form always renders one more of each than there are, and an
 * untouched one is dropped by `descriptionFrom` because it has no content and
 * no image. Nobody has to press "add" before typing.
 */
export function withBlankRows(rows: readonly DescriptionRow[]): DescriptionRow[] {
    const next = rows.length + 1
    return [
        ...rows,
        { kind: 'paragraph', content: '', position: String(next), remove: false },
        { kind: 'image', content: '', position: String(next + 1), remove: false },
    ]
}

/**
 * The long description the rows describe: removals dropped, the rest in the
 * order their positions ask for.
 *
 * Sorted by the typed position rather than trusted to be sequential, so `1, 2,
 * 2.5, 3` does what somebody obviously meant and `1, 1, 1` leaves the order
 * alone. Ties keep their existing order, which is what makes a partly-filled
 * column behave: renumber the two rows you care about and the rest stay put.
 *
 * An empty paragraph is dropped rather than committed. There is no such thing
 * as a blank paragraph on the public page, and it is how the blank row at the
 * end of the form stays ignorable.
 */
export function descriptionFrom(rows: readonly DescriptionRow[]): Course['description_long'] {
    return rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !row.remove)
        .filter(({ row }) => (row.kind === 'paragraph' ? row.content.trim() !== '' : Boolean(row.url || row.object)))
        .sort((a, b) => {
            const byPosition = (Number(a.row.position) || 0) - (Number(b.row.position) || 0)
            return byPosition !== 0 ? byPosition : a.index - b.index
        })
        .map(({ row }) =>
            row.kind === 'paragraph'
                ? { type: 'paragraph' as const, content: row.content.trim() }
                : row.object
                  ? { type: 'image' as const, object: row.object }
                  : { type: 'image' as const, url: row.url! }
        )
}

/**
 * The whole course a form describes, built on the stored one.
 *
 * The starting point is `stored` rather than an empty object, which is what
 * carries the scorecard, the hole descriptions, the images and the datasources
 * through untouched. An editor that rebuilt the record from its own fields would
 * delete every one of them — and silently, because Zod strips what it is not
 * told about rather than complaining. `course-schema-coverage.test.ts` exists
 * about that failure one level down.
 */
export function courseFromForm(stored: Course, form: CourseForm): Course {
    const withProse: Course = {
        ...stored,
        name: form.name.trim(),
        homepage: form.homepage.trim(),
        contact: {
            address: form.address.trim(),
            ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
            ...(form.email.trim() ? { email: form.email.trim() } : {}),
        },
        description_short: form.descriptionShort.trim(),
        description_long: descriptionFrom(form.description),
    }

    // `applyTeeEdits` is what moves the scorecard's keys with a renamed tee.
    return withProse.course ? applyTeeEdits(withProse, teesFrom(form.tees)) : withProse
}
