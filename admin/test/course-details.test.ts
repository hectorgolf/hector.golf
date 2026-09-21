import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { schema as courseSchema, withTeeIds, type Course } from '@hector/schemas/src/courses.ts'

import { BLANK_TEE, courseFromForm, formOf, teesFrom } from '../src/lib/courses/details.ts'

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
     * Indexed by position in `description_long`, not packed into a list, because
     * the images between the paragraphs keep their places and the indices are
     * what puts the prose back where it came from.
     */
    it('indexes the paragraphs by their place among the images', () => {
        const course = konopiste()
        const form = formOf(course)

        const paragraphIndices = course.description_long
            .map((part, index) => (part.type === 'paragraph' ? index : undefined))
            .filter((index): index is number => index !== undefined)

        expect(Object.keys(form.paragraphs).map(Number)).toEqual(paragraphIndices)
        expect(paragraphIndices).not.toEqual([...paragraphIndices.keys()])
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
        const first = Number(Object.keys(form.paragraphs)[0])

        const result = courseFromForm(course, {
            ...form,
            paragraphs: { ...form.paragraphs, [first]: 'Rewritten.' },
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
