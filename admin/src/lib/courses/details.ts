import { applyTeeEdits, type Course, type CourseTee } from '@hector/schemas/src/courses.ts'

import { datasourceRows, datasourcesFrom, type DatasourceRow } from './datasources.ts'
import { holeRows, scorecardFrom, type HoleRow } from './scorecard.ts'

/**
 * What a person writes on a golf course, read off a submitted form.
 *
 * Identity, contact, the prose, the datasources, the tees and the scorecard. The
 * scorecard arrived last and was argued against here for a while — around 130
 * numbers off an official card, a transcription exercise with no proofreader —
 * and the argument was answered rather than overruled: one grid rather than two,
 * because sixteen of the seventeen courses have no women's card at all.
 *
 * What is still *not* here is deliberate rather than unfinished:
 *
 * - **Hole descriptions.** Prose, eighteen at a time and in two languages for
 *   the Tahko courses. Worth an editor; worth its own one.
 * - **Images.** Paths. Nothing has asked.
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
    /** The picture the course card and the course page lead with. */
    hero: HeroForm
    /** The long description, in the order the boxes are in. */
    description: DescriptionRow[]
    /** Where the numbers came from: a URL box per name. */
    datasources: DatasourceRow[]
    /** The scorecard, one row per hole. Empty for a course that has none. */
    holes: HoleRow[]
    tees: TeeForm[]
}

/**
 * One row of the long description: a paragraph or an image, plus what the form
 * lets somebody do to it.
 *
 * Ordering is a number somebody types, which is the simplest thing that works
 * with no script — and that is the whole of the reason, stated plainly because
 * the tempting version of it is wrong.
 *
 * The tempting version: "buttons would mean a round trip per move". They would
 * not. Buttons or drag-and-drop done in the browser reorder the rows in the
 * page and submit once, exactly as this does, and nothing would reach the
 * server until Save. They would also let the position stay hidden, which it
 * should be — it is how the form talks to itself, not something a person
 * editing prose should have to think about.
 *
 * So the cost of this design is real and is paid by the reader: they see an
 * implementation detail. The server side is indifferent — it sorts by whatever
 * numbers arrive — so enhancing this with client-side reordering later changes
 * the page and nothing here.
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

/**
 * The hero image, as the form carries it.
 *
 * The same two sources a description image has — `url` for one already on the
 * site, `object` for one in the bucket that no export has fetched yet — plus
 * the one thing a hero can do that a description row cannot express by going
 * empty: be taken away. A course with no hero is a course the schema allows,
 * and clearing a file input is not something a browser lets somebody do.
 */
export type HeroForm = {
    url?: string
    object?: string
    /** Ticked to leave the course with no hero at all. */
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

/**
 * Whether a tee is played by women at all, as the record says it.
 *
 * Either number is enough. A tee with a ladies course rating and no slope, or
 * the other way round, is a tee somebody has measured for women and recorded
 * half of — and the question this answers is "is there a women's par to state",
 * not "is this record complete".
 */
const playedByLadies = (tee: CourseTee): boolean => tee.rating.ladies !== null || tee.slope.ladies !== null

const teeOf = (tee: CourseTee): TeeForm => ({
    id: tee.id,
    name: tee.name,
    nameLocal: tee.name_local ?? '',
    color: tee.color,
    length: String(tee.length),
    par: String(tee.par),
    /*
     * The men's par, for a tee played by women that does not state its own.
     *
     * Forty-eight of the fifty-one such tees say nothing, and the three that do
     * — Sand Valley's — say 73 against a men's 72. So the usual case is that
     * they agree and nobody wrote it down, and the interesting case is already
     * written down; showing the number that is almost certainly right beats an
     * empty box somebody has to decide about.
     *
     * A real value rather than a placeholder, so it saves. That is the point:
     * a tee played by women ends up stating its par instead of leaving it to be
     * inferred from a field that is absent for two different reasons.
     */
    parLadies:
        tee.par_ladies !== undefined
            ? String(tee.par_ladies)
            : playedByLadies(tee)
              ? String(tee.par)
              : '',
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
    const tees: TeeForm[] = [...(course.course?.tees ?? []).map(teeOf), { ...BLANK_TEE }]
    return {
        name: course.name,
        homepage: course.homepage,
        address: course.contact.address,
        phone: course.contact.phone ?? '',
        email: course.contact.email ?? '',
        descriptionShort: course.description_short,
        hero: { ...course.hero_image, remove: false },
        /*
         * With the blank rows, exactly as the tees line below carries its blank
         * tee — and for the reason the tees never had this bug and the
         * description did: what `formOf` answers is what the page renders, so a
         * form's indices refer to it. Leaving the blanks to a second call meant
         * the POST handler sized its loop on the stored count and never read the
         * two rows somebody had just typed into.
         */
        description: withBlankRows(descriptionOf(course)),
        datasources: datasourceRows(course),
        tees,
        // A length column per tee row, the blank one included, so a tee and its
        // lengths can be added in the same save.
        holes: holeRows(course, tees.map((tee) => tee.name)),
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
 * Which rows of a repeating group a submitted form carries.
 *
 * Read off the keys rather than counted from what the page last rendered,
 * because those two stopped agreeing twice. First when `formOf` answered the
 * stored rows while the page rendered two blank ones after them: the editor's
 * loop ran `item-0` through `item-{stored - 1}` and never read the row somebody
 * had just typed a paragraph into, or the one they had just chosen an image in,
 * so both appeared to save and neither did. Then again the moment the page
 * could add rows in the browser, where the count is whatever somebody pressed
 * the button.
 *
 * Every row carries its own index, so a row is whatever arrived under
 * `<prefix>-N-`. Gaps are fine — a row removed in the browser simply does not
 * turn up — and the indices are sorted numerically because `10` sorts before
 * `2` as text and this order is the tie-break `descriptionFrom` falls back on
 * for equal positions.
 *
 * The tees need this for the same reason and had the same bug: their loop ran
 * over the rows the page had rendered, so a tee added in the browser was read
 * as nothing at all.
 */
export function formIndices(form: FormData, prefix: string): number[] {
    const pattern = new RegExp(`^${prefix}-(\\d+)-`)
    const seen = new Set<number>()
    for (const key of form.keys()) {
        const match = pattern.exec(key)
        if (match) seen.add(Number(match[1]))
    }
    return [...seen].sort((a, b) => a - b)
}

/** The description's rows, which is where this was needed first. */
export const rowIndices = (form: FormData): number[] => formIndices(form, 'item')

/**
 * The rows, plus one empty paragraph and one empty image row at the end.
 *
 * How a description item gets added without script, and the same trick the tee
 * table uses: the form always renders one more of each than there are, and an
 * untouched one is dropped by `descriptionFrom` because it has no content and
 * no image. Nobody has to press "add" before typing.
 */
export function withBlankRows(rows: readonly DescriptionRow[]): DescriptionRow[] {
    /*
     * Every blank row is dropped before a fresh pair is added, so applying this
     * twice gives the same answer as applying it once. A page that re-renders
     * after a rejected save would otherwise grow two more empty rows each time.
     *
     * Every one rather than the trailing ones, because a blank row does not
     * stay at the end. Reordering in the browser moves the real rows past the
     * blanks, and what comes back is then blank rows in the middle — which the
     * trailing test walked straight past, leaving them there and adding two
     * more. They are dropped wherever they are for the same reason
     * `descriptionFrom` drops them wherever they are: an empty row is not an
     * item, and where it sits says nothing about it.
     */
    const filled = rows.filter((row) => !isBlank(row))

    const next = filled.length + 1
    return [
        ...filled,
        { kind: 'paragraph', content: '', position: String(next), remove: false },
        { kind: 'image', content: '', position: String(next + 1), remove: false },
    ]
}

/**
 * Nothing typed and no image: the state a blank row is still in.
 *
 * Exported because the page renders a blank row differently — no remove box,
 * and hidden entirely once the script is adding rows on demand — and "blank"
 * had better mean the same thing there as it does to `descriptionFrom`, which
 * is what actually drops these.
 */
export const isBlank = (row: DescriptionRow): boolean =>
    row.content.trim() === '' && !row.url && !row.object

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
 * The hero the form describes, or `undefined` for a course that should have
 * none.
 *
 * `object` wins over `url` when both are set, which is what makes replacing a
 * published hero keep the new picture rather than the one still on the site.
 * The old `url` is dropped rather than carried along: the export will write the
 * uploaded object to a path of its own, and a stale `url` beside it is a second
 * answer to where the hero is.
 */
export function heroFrom(hero: HeroForm): Course['hero_image'] {
    if (hero.remove) return undefined
    if (hero.object) return { object: hero.object }
    return hero.url ? { url: hero.url } : undefined
}

/**
 * The whole course a form describes, built on the stored one.
 *
 * The starting point is `stored` rather than an empty object, which is what
 * carries the scorecard, the hole descriptions and the images through
 * untouched. An editor that rebuilt the record from its own fields would delete
 * every one of them — and silently, because Zod strips what it is not
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
        datasources: datasourcesFrom(form.datasources),
    }

    // Assigned rather than spread, because `hero_image` is optional and
    // `{ ...stored, hero_image: undefined }` is a course with the key present
    // and empty — which the schema refuses and a reader would read as "no hero"
    // either way. Deleting it says the one thing meant.
    const hero = heroFrom(form.hero)
    if (hero) withProse.hero_image = hero
    else delete withProse.hero_image

    if (!withProse.course) return withProse

    // `applyTeeEdits` is what moves the scorecard's keys with a renamed tee, so
    // it runs first and the grid is written onto its answer: by then the tees
    // have their final names, and the k-th surviving tee is the k-th named row
    // of the form.
    const withTees = applyTeeEdits(withProse, teesFrom(form.tees))

    if (form.holes.length === 0) return withTees

    const columns = form.tees
        .map((tee, index) => ({ tee, index }))
        .filter(({ tee }) => tee.name.trim() !== '')
        .map(({ index }) => index)

    return {
        ...withTees,
        course: scorecardFrom(
            withTees,
            (withTees.course?.tees ?? []).map((tee) => tee.name),
            columns,
            form.holes
        ),
    }
}
