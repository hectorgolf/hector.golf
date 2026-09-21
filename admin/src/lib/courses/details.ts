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
    /** One per `description_long` paragraph, by its index in that array. */
    paragraphs: Record<number, string>
    tees: TeeForm[]
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

/** The stored course as the boxes should first show it. */
export function formOf(course: Course): CourseForm {
    const paragraphs: Record<number, string> = {}
    course.description_long.forEach((part, index) => {
        if (part.type === 'paragraph') paragraphs[index] = part.content ?? ''
    })

    return {
        name: course.name,
        homepage: course.homepage,
        address: course.contact.address,
        phone: course.contact.phone ?? '',
        email: course.contact.email ?? '',
        descriptionShort: course.description_short,
        paragraphs,
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
 * The whole course a form describes, built on the stored one.
 *
 * The starting point is `stored` rather than an empty object, which is what
 * carries the scorecard, the hole descriptions, the images and the datasources
 * through untouched. An editor that rebuilt the record from its own fields would
 * delete every one of them — and silently, because Zod strips what it is not
 * told about rather than complaining. `course-schema-coverage.test.ts` exists
 * about that failure one level down.
 *
 * `description_long` is rebuilt by index for the same reason. Thirty-two of its
 * entries across fifteen courses are *images*, interleaved with the prose, and a
 * textarea holding only the paragraphs would drop all of them. Only the
 * paragraph contents are replaced; every entry keeps its place.
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
        description_long: stored.description_long.map((part, index) =>
            part.type === 'paragraph' ? { ...part, content: form.paragraphs[index]?.trim() ?? part.content } : part
        ),
    }

    // `applyTeeEdits` is what moves the scorecard's keys with a renamed tee.
    return withProse.course ? applyTeeEdits(withProse, teesFrom(form.tees)) : withProse
}
