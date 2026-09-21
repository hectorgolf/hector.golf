import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { schema as courseSchema, withTeeIds, type Course } from '@hector/schemas/src/courses.ts'

import {
    BLANK_TEE,
    courseFromForm,
    descriptionFrom,
    formOf,
    heroFrom,
    teesFrom,
    rowIndices,
    withBlankRows,
    type DescriptionRow,
} from '../src/lib/courses/details.ts'

/**
 * What the course editor makes of a filled-in form.
 *
 * The decision this file exists for is **what a save does to the fields the form
 * does not carry**. A course is mostly scorecard: eighteen holes of par, stroke
 * index and a length per tee, plus hole descriptions in up to two languages,
 * images and datasources. None of that is editable here, all of it has to
 * survive, and Zod strips what it is not told about rather than complaining — so
 * an editor that rebuilt the record from its own fields would delete the larger
 * half of it without anything failing.
 *
 * `course-schema-coverage.test.ts` pins the same failure one level down, where
 * the schema is the thing with the blind spot. This pins it where the *form* is.
 */

const here = dirname(fileURLToPath(import.meta.url))

/**
 * A course as the *store* holds it, which is what the editor is handed.
 *
 * `withTeeIds` is the difference, and it is not incidental: the committed files
 * carry no tee ids, the seed adds them on the way in, and the editor matches a
 * renamed tee by one. A fixture read straight off disk would be testing a shape
 * `getCourse()` never returns.
 */
const real = (id: string): Course =>
    withTeeIds(
        courseSchema.parse(
            JSON.parse(readFileSync(join(here, `../../astrosite/src/data/courses/${id}.json`), 'utf-8'))
        ) as Course
    )

/** A course with images in its long description and five tees. */
const konopiste = () => real('konopiste-radecky')

describe('filling the boxes from a stored course', () => {
    it('offers one more tee row than there are tees, which is how one is added', () => {
        const course = konopiste()
        const form = formOf(course)

        expect(form.tees).toHaveLength(course.course!.tees.length + 1)
        expect(form.tees.at(-1)!.name).toBe('')
        expect(form.tees.at(-1)!.id).toBeUndefined()
    })

    it('keeps each tee its id, which is what a rename is matched by', () => {
        const form = formOf(konopiste())
        expect(form.tees.slice(0, -1).map((tee) => tee.id)).toEqual(['black', 'white', 'yellow', 'blue', 'red'])
    })

    /**
     * A row per entry, paragraphs and images alike, in the order the record has
     * them. The editor can move and remove them, so the list *is* the model
     * rather than an index into one.
     */
    it('gives every description entry a row, in order', () => {
        const course = konopiste()
        const stored = formOf(course).description.slice(0, course.description_long.length)

        expect(stored.map((row) => row.kind)).toEqual(course.description_long.map((part) => part.type))
        expect(stored.map((row) => row.position)).toEqual(
            course.description_long.map((_, index) => String(index + 1))
        )
    })

    /**
     * The blank rows are part of what `formOf` answers, exactly as the blank tee
     * is — and this is the assertion that would have caught the bug they were
     * missing from.
     *
     * The page loops over `formOf(course).description` to read a submitted form
     * back. When the blanks were added separately, and only on the GET path,
     * that loop ran `stored` times against a form with `stored + 2` rows in it:
     * it never read the two somebody had just typed into. Adding a paragraph
     * saved nothing, said it had saved, and left no trace anywhere.
     */
    it('ends with an empty paragraph and an empty image row, which is how one is added', () => {
        const course = konopiste()
        const form = formOf(course)

        expect(form.description).toHaveLength(course.description_long.length + 2)
        expect(form.description.at(-2)).toMatchObject({ kind: 'paragraph', content: '' })
        expect(form.description.at(-1)!.kind).toBe('image')
        expect(form.description.at(-1)!.url).toBeUndefined()
        expect(form.description.at(-1)!.object).toBeUndefined()
    })

    /** Applying it twice is applying it once, so a rejected save does not grow the form. */
    it('does not stack more blank rows on each re-render', () => {
        const once = formOf(konopiste()).description
        expect(withBlankRows(once)).toHaveLength(once.length)
    })

    /*
     * The same promise, for rows that came back in the order somebody put them
     * in rather than the order they were rendered in.
     *
     * Reordering in the browser moves the real rows past the blank ones, so
     * what a rejected save gets back has its blanks in the middle. Dropping
     * only the trailing ones left them there and added two more — every retry
     * two more again.
     */
    it('drops a blank row that reordering left in the middle', () => {
        const reordered = [
            { kind: 'paragraph' as const, content: 'One.', position: '1', remove: false },
            { kind: 'paragraph' as const, content: '', position: '4', remove: false },
            { kind: 'image' as const, content: '', position: '5', remove: false },
            { kind: 'paragraph' as const, content: 'Two.', position: '2', remove: false },
        ]

        const rows = withBlankRows(reordered)

        expect(rows.filter((row) => row.content === '')).toHaveLength(2)
        expect(rows.map((row) => row.content)).toEqual(['One.', 'Two.', '', ''])
    })
})

/*
 * Which rows the editor reads back, which is the question it got wrong twice.
 *
 * Both times the same way: it answered with a count of what it had rendered
 * rather than with what had arrived. First the count was two short, so the row
 * somebody had typed a paragraph into and the row they had chosen an image in
 * were never read — the save reported success and did nothing. Then the page
 * learned to add rows in the browser, and no count could have been right.
 */
describe('finding the rows a submitted form carries', () => {
    const formWith = (...names: string[]): FormData => {
        const form = new FormData()
        for (const name of names) form.append(name, '')
        return form
    }

    it('finds every row, and nothing that is not one', () => {
        const form = formWith('name', 'item-0-content', 'item-0-position', 'item-1-file', 'tee-0-name')

        expect(rowIndices(form)).toEqual([0, 1])
    })

    /** Rows added in the browser, which the page never rendered and cannot count. */
    it('finds rows past the ones the page rendered', () => {
        const form = formWith('item-0-content', 'item-5-content', 'item-6-file')

        expect(rowIndices(form)).toEqual([0, 5, 6])
    })

    /** A row removed in the browser leaves a hole, and a hole is not a row. */
    it('is happy with gaps', () => {
        expect(rowIndices(formWith('item-0-content', 'item-3-content'))).toEqual([0, 3])
    })

    /*
     * Numerically. As text `10` sorts before `2`, and this order is the
     * tie-break `descriptionFrom` falls back on when two rows claim the same
     * position — so a form with ten rows in it would quietly reorder itself.
     */
    it('orders the rows by number rather than by name', () => {
        const form = formWith('item-10-content', 'item-2-content', 'item-1-content')

        expect(rowIndices(form)).toEqual([1, 2, 10])
    })
})

describe('what a save leaves alone', () => {
    const saved = () => {
        const course = konopiste()
        return { course, result: courseFromForm(course, { ...formOf(course), name: 'Renamed' }) }
    }

    it('keeps the scorecard, to the last length', () => {
        const { course, result } = saved()
        expect(result.course!.scorecard).toEqual(course.course!.scorecard)
    })

    it('keeps the hole descriptions, in both languages', () => {
        const { course, result } = saved()
        expect(result.course!.descriptions).toEqual(course.course!.descriptions)
        expect(result.course!.descriptions_local).toEqual(course.course!.descriptions_local)
    })

    it('keeps the images, the datasources and the id', () => {
        const { course, result } = saved()
        expect(result.images).toEqual(course.images)
        expect(result.datasources).toEqual(course.datasources)
        expect(result.id).toBe(course.id)
    })

    /*
     * The hero *is* carried by the form now, so this is not the "untouched"
     * property the rest of this block asserts — it is the narrower one that
     * matters as much: a save where nobody went near the hero leaves it exactly
     * where it was. A field the form carries is a field a save can erase.
     */
    it('keeps the hero image when nobody touched it', () => {
        const { course, result } = saved()
        expect(result.hero_image).toEqual(course.hero_image)
    })

    /**
     * The one that would go unnoticed. Fifteen of the seventeen courses have
     * images interleaved with their prose — thirty-two entries in all — and a
     * textarea holding only the paragraphs would drop every one.
     */
    it('keeps the images inside the long description, in place', () => {
        const { course, result } = saved()

        expect(result.description_long.map((part) => part.type)).toEqual(
            course.description_long.map((part) => part.type)
        )
        expect(result.description_long.filter((part) => part.type === 'image')).toEqual(
            course.description_long.filter((part) => part.type === 'image')
        )
    })

    /**
     * The blank rows the form ends with, which are how an item is added. An
     * untouched pair must leave the description exactly as it was, or every
     * save of an unrelated field would append an empty paragraph.
     */
    it('ignores the blank rows nobody typed into', () => {
        const course = konopiste()
        const result = courseFromForm(course, {
            ...formOf(course),
            description: withBlankRows(formOf(course).description),
        })

        expect(result.description_long).toEqual(course.description_long)
    })

    it('still parses as a course afterwards', () => {
        const { result } = saved()
        expect(courseSchema.safeParse(result).success).toBe(true)
    })
})

describe('what a save changes', () => {
    it('takes the identity and contact fields from the form', () => {
        const course = konopiste()
        const result = courseFromForm(course, {
            ...formOf(course),
            name: '  Konopiště - Radecký II  ',
            homepage: 'https://example.com',
            address: ' Somewhere Else ',
            phone: '',
            email: 'new@example.com',
        })

        expect(result.name).toBe('Konopiště - Radecký II')
        expect(result.homepage).toBe('https://example.com')
        expect(result.contact.address).toBe('Somewhere Else')
        expect(result.contact.email).toBe('new@example.com')
        // An emptied box means the field is absent, not empty — the schema
        // leaves it out and the page renders an em dash.
        expect(result.contact.phone).toBeUndefined()
    })

    it('rewrites a paragraph without disturbing its neighbours', () => {
        const course = konopiste()
        const form = formOf(course)
        const first = form.description.findIndex((row) => row.kind === 'paragraph')

        const result = courseFromForm(course, {
            ...form,
            description: form.description.map((row, index) =>
                index === first ? { ...row, content: 'Rewritten.' } : row
            ),
        })

        const part = result.description_long[first]
        expect(part.type === 'paragraph' && part.content).toBe('Rewritten.')
        expect(result.description_long.length).toBe(course.description_long.length)
    })

    /**
     * The whole reason tees have ids. Per-hole lengths are keyed by tee *name*,
     * so a rename has to move the scorecard's keys with it or every length for
     * that tee resolves to nothing.
     */
    it('moves the scorecard keys when a tee is renamed', () => {
        const course = konopiste()
        const form = formOf(course)
        const result = courseFromForm(course, {
            ...form,
            tees: form.tees.map((tee) => (tee.name === 'White' ? { ...tee, name: 'Gold' } : tee)),
        })

        const lengths = result.course!.scorecard.men[0]!.lengths as Record<string, number>
        const before = course.course!.scorecard.men[0]!.lengths as Record<string, number>

        expect(lengths.Gold).toBe(before.White)
        expect(lengths).not.toHaveProperty('White')
        expect(result.course!.tees.find((tee) => tee.name === 'Gold')!.id).toBe('white')
    })

    it('adds a tee from the blank row and gives it an id', () => {
        const course = konopiste()
        const form = formOf(course)
        const result = courseFromForm(course, {
            ...form,
            tees: form.tees.map((tee, index) =>
                index === form.tees.length - 1
                    ? { ...BLANK_TEE, name: 'Gold', color: '#d4af37', length: '5000', par: '72' }
                    : tee
            ),
        })

        const added = result.course!.tees.at(-1)!
        expect(added.name).toBe('Gold')
        expect(added.id).toBe('gold')
        expect(courseSchema.safeParse(result).success).toBe(true)
    })
})

describe('reading the tee rows', () => {
    it('drops a row nobody typed a name into', () => {
        expect(teesFrom([{ ...BLANK_TEE }])).toEqual([])
    })

    /**
     * `NaN` rather than a dropped field, so the schema refuses it and the page
     * says so. Reporting a successful save while discarding what was typed is
     * the one outcome a person cannot detect.
     */
    it('lets a length that is not a number reach the schema as NaN', () => {
        const [tee] = teesFrom([{ ...BLANK_TEE, name: 'Gold', length: 'about 5000', par: '72' }])
        expect(tee.length).toBeNaN()
        expect(courseSchema.safeParse({ course: { tees: [tee] } }).success).toBe(false)
    })

    it('spells an unmeasured rating null, which is how the data spells it', () => {
        const [tee] = teesFrom([{ ...BLANK_TEE, name: 'Gold', length: '5000', par: '72' }])
        expect(tee.rating).toEqual({ men: null, ladies: null })
        expect(tee.slope).toEqual({ men: null, ladies: null })
    })

    it('leaves out a local name nobody gave, rather than storing an empty one', () => {
        const [tee] = teesFrom([{ ...BLANK_TEE, name: 'Gold', length: '5000', par: '72' }])
        expect(tee).not.toHaveProperty('name_local')
    })
})

describe('the rule the scorecard depends on', () => {
    /**
     * Two tees sharing a name would make a per-hole length ambiguous, since that
     * is the key. The schema refuses it, so `saveCourse` does too and the page
     * shows the message rather than writing a course nothing can render.
     */
    it('refuses two tees with the same name, case included', () => {
        const course = konopiste()
        const form = formOf(course)
        const result = courseFromForm(course, {
            ...form,
            tees: form.tees.map((tee) => (tee.name === 'White' ? { ...tee, name: 'yellow' } : tee)),
        })

        const parsed = courseSchema.safeParse(result)
        expect(parsed.success).toBe(false)
    })
})

/**
 * Composing a description, which is what step 5 of the plan is about.
 *
 * Step 4's editor could rewrite a paragraph and nothing else: the order was
 * fixed and the images were read-only markers, because a textarea holding only
 * the prose would have deleted the 32 image entries interleaved with it. This
 * is the model that replaced it — a row per entry, ordered by a number somebody
 * types, with add, remove and replace.
 */
const row = (over: Partial<DescriptionRow> & { kind: DescriptionRow['kind'] }): DescriptionRow => ({
    content: '',
    position: '1',
    remove: false,
    ...over,
})

describe('composing the long description', () => {
    it('orders by the typed position, not by the order of the boxes', () => {
        const result = descriptionFrom([
            row({ kind: 'paragraph', content: 'Third.', position: '3' }),
            row({ kind: 'paragraph', content: 'First.', position: '1' }),
            row({ kind: 'paragraph', content: 'Second.', position: '2' }),
        ])

        expect(result.map((part) => part.type === 'paragraph' && part.content)).toEqual([
            'First.',
            'Second.',
            'Third.',
        ])
    })

    /**
     * Ties keep the order they are in, which is what makes a partly-filled
     * column usable: renumber the two rows you care about and the rest stay put
     * rather than shuffling.
     */
    it('leaves tied positions in the order they were already in', () => {
        const result = descriptionFrom([
            row({ kind: 'paragraph', content: 'A.', position: '1' }),
            row({ kind: 'paragraph', content: 'B.', position: '1' }),
            row({ kind: 'paragraph', content: 'C.', position: '1' }),
        ])

        expect(result.map((part) => part.type === 'paragraph' && part.content)).toEqual(['A.', 'B.', 'C.'])
    })

    it('accepts a fractional position, which is how a row is slipped between two', () => {
        const result = descriptionFrom([
            row({ kind: 'paragraph', content: 'One.', position: '1' }),
            row({ kind: 'paragraph', content: 'Two.', position: '2' }),
            row({ kind: 'paragraph', content: 'Between.', position: '1.5' }),
        ])

        expect(result.map((part) => part.type === 'paragraph' && part.content)).toEqual([
            'One.',
            'Between.',
            'Two.',
        ])
    })

    it('drops a row that was marked for removal', () => {
        const result = descriptionFrom([
            row({ kind: 'paragraph', content: 'Kept.', position: '1' }),
            row({ kind: 'paragraph', content: 'Gone.', position: '2', remove: true }),
            row({ kind: 'image', url: '/images/courses/x/a.jpg', position: '3', remove: true }),
        ])

        expect(result).toEqual([{ type: 'paragraph', content: 'Kept.' }])
    })

    /**
     * An empty paragraph is not a thing the public page has, and dropping it is
     * what lets the form end with blank rows nobody has to press "add" before
     * using.
     */
    it('drops an empty paragraph and an image with nothing behind it', () => {
        expect(descriptionFrom([row({ kind: 'paragraph', content: '   ' }), row({ kind: 'image' })])).toEqual([])
    })

    it('keeps an image that is already committed, by its url', () => {
        const result = descriptionFrom([row({ kind: 'image', url: '/images/courses/x/hero.jpg' })])
        expect(result).toEqual([{ type: 'image', url: '/images/courses/x/hero.jpg' }])
    })

    /**
     * An uploaded image is recorded by its object name and *not* by a url. The
     * export is what turns one into the other, so a committed file never
     * mentions the bucket and the site needs no change at all.
     */
    it('records an uploaded image by object, never by url', () => {
        const result = descriptionFrom([
            row({ kind: 'image', object: 'courses/x/abc123.jpg', url: '/images/courses/x/old.jpg' }),
        ])

        expect(result).toEqual([{ type: 'image', object: 'courses/x/abc123.jpg' }])
    })

    it('mixes paragraphs and images in one order', () => {
        const result = descriptionFrom([
            row({ kind: 'image', object: 'courses/x/pic.jpg', position: '2' }),
            row({ kind: 'paragraph', content: 'Before.', position: '1' }),
            row({ kind: 'paragraph', content: 'After.', position: '3' }),
        ])

        expect(result.map((part) => part.type)).toEqual(['paragraph', 'image', 'paragraph'])
    })
})

/**
 * Adding an item *where you want it*, which is the path somebody actually
 * takes and the one the other cases here skirted.
 *
 * Both halves matter and neither is obvious from the form: the blank rows at
 * the end are how an item is added, and their position boxes are how it lands
 * anywhere but last. Tested together because separately they each pass while
 * the combination is what a person does.
 */
describe('adding an item at a chosen position', () => {
    const existing: DescriptionRow[] = [
        { kind: 'paragraph', content: 'One.', position: '1', remove: false },
        { kind: 'image', content: '', url: '/images/a.jpg', position: '2', remove: false },
        { kind: 'paragraph', content: 'Three.', position: '3', remove: false },
    ]

    const shape = (parts: ReturnType<typeof descriptionFrom>) =>
        parts.map((part) => (part.type === 'paragraph' ? part.content : (part.object ?? part.url)))

    it('puts a new paragraph between two existing entries', () => {
        const rows = withBlankRows(existing)
        rows[3] = { ...rows[3]!, content: 'Inserted.', position: '1.5' }

        expect(shape(descriptionFrom(rows))).toEqual(['One.', 'Inserted.', '/images/a.jpg', 'Three.'])
    })

    it('puts a new image between two existing entries', () => {
        const rows = withBlankRows(existing)
        rows[4] = { ...rows[4]!, object: 'courses/x/new.jpg', position: '2.5' }

        expect(shape(descriptionFrom(rows))).toEqual([
            'One.',
            '/images/a.jpg',
            'courses/x/new.jpg',
            'Three.',
        ])
    })

    /** Including at the very front, which is what a position below 1 is for. */
    it('adds both in one save, each where it was asked for', () => {
        const rows = withBlankRows(existing)
        rows[3] = { ...rows[3]!, content: 'First now.', position: '0' }
        rows[4] = { ...rows[4]!, object: 'courses/x/new.jpg', position: '2.5' }

        expect(shape(descriptionFrom(rows))).toEqual([
            'First now.',
            'One.',
            '/images/a.jpg',
            'courses/x/new.jpg',
            'Three.',
        ])
    })
})


describe('the hero image', () => {
    const committed = { url: '/images/courses/konopiste-radecky/hero.jpg' }

    it('stays as it is when the form carries it back unchanged', () => {
        expect(heroFrom({ ...committed, remove: false })).toEqual(committed)
    })

    /*
     * An upload replaces, and the old `url` goes with it. Keeping both would
     * leave the record saying the hero is in two places, and the export would
     * write the object to a path of its own — so the stale url would be a
     * second answer that happens to still resolve, which is the worst kind.
     */
    it('is replaced by an upload, and the old path goes', () => {
        const hero = heroFrom({ ...committed, object: 'courses/konopiste-radecky/abc123.jpg', remove: false })

        expect(hero).toEqual({ object: 'courses/konopiste-radecky/abc123.jpg' })
        expect(hero).not.toHaveProperty('url')
    })

    it('can be taken away, which is the one thing an empty file input cannot say', () => {
        expect(heroFrom({ ...committed, remove: true })).toBeUndefined()
    })

    it('is undefined for a course that never had one', () => {
        expect(heroFrom({ remove: false })).toBeUndefined()
    })

    /*
     * `delete` rather than `hero_image: undefined`. The key would otherwise be
     * present and empty, which the schema refuses — and a save that removed the
     * hero would fail validation rather than remove the hero.
     */
    it('leaves no empty key behind when it is removed', () => {
        const course = konopiste()
        const result = courseFromForm(course, { ...formOf(course), hero: { remove: true } })

        expect('hero_image' in result).toBe(false)
        expect(courseSchema.safeParse(result).success).toBe(true)
    })

    /** And the round trip: what `formOf` reads, `courseFromForm` writes back. */
    it('survives a form it was only read into and out of', () => {
        const course = konopiste()
        const result = courseFromForm(course, formOf(course))

        expect(result.hero_image).toEqual(course.hero_image)
        expect(courseSchema.safeParse(result).success).toBe(true)
    })
})
