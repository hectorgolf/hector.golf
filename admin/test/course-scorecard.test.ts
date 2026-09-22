import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { schema as courseSchema, withTeeIds, type Course } from '@hector/schemas/src/courses.ts'

import { courseFromForm, formOf } from '../src/lib/courses/details.ts'
import { holeRows, scorecardFrom } from '../src/lib/courses/scorecard.ts'

const here = dirname(fileURLToPath(import.meta.url))
const real = (id: string): Course =>
    withTeeIds(
        courseSchema.parse(
            JSON.parse(readFileSync(join(here, `../../astrosite/src/data/courses/${id}.json`), 'utf-8'))
        ) as Course
    )

const ids = [
    'adamstal-championship',
    'diamondcc-country',
    'diamondcc-diamond',
    'diamondcc-park',
    'emporda-dunes',
    'emporda-forest',
    'konopiste-deste',
    'konopiste-radecky',
    'lafinca',
    'penati-heritage',
    'penati-legend',
    'quellness-beckenbauer',
    'quellness-porsche',
    'sandvalley',
    'tahko-new-course',
    'tahko-old-course',
    'villamartin',
]

/*
 * The scorecard is the largest thing in a course record and the one nobody can
 * retype: around 130 numbers on an eighteen-hole course with five tees. The
 * editor rebuilds it from its own boxes, which is exactly the shape of mistake
 * that ate `stroke` off the tees — so the first thing asked of it is that a
 * save which touches nothing changes nothing, on every committed course.
 */
describe('a save that touches nothing keeps the scorecard exactly', () => {
    it.each(ids)('reproduces every hole of %s', (id) => {
        const course = real(id)

        expect(courseFromForm(course, formOf(course)).course?.scorecard).toEqual(course.course?.scorecard)
    })

    /** Including the one course that has a women's card, which is the hard case. */
    it("reproduces sandvalley's women's card, differing hole and all", () => {
        const course = real('sandvalley')
        const ladies = course.course!.scorecard.ladies
        expect(Array.isArray(ladies)).toBe(true)

        expect(courseFromForm(course, formOf(course)).course?.scorecard.ladies).toEqual(ladies)
    })

    /** And the sixteen that have none do not grow one by being looked at. */
    it.each(ids.filter((id) => id !== 'sandvalley'))('leaves %s without a women’s card', (id) => {
        const course = real(id)

        expect(courseFromForm(course, formOf(course)).course?.scorecard.ladies ?? null).toBeNull()
    })
})

/*
 * One grid, not two. Sand Valley's women's card differs from its men's on a
 * single hole — par 4 becomes 5 at the eleventh — and that is the only
 * difference anywhere in the committed data. Eighteen rows to record one
 * number.
 */
describe('the women’s par column', () => {
    it('is empty wherever the two cards agree', () => {
        const rows = holeRows(real('sandvalley'), ['Cherry', 'Blue', 'Green', 'White'])
        const stated = rows.filter((row) => row.parLadies !== '')

        expect(stated).toHaveLength(1)
        expect(stated[0]!.hole).toBe(11)
        expect(stated[0]!.parLadies).toBe('5')
    })

    it('is empty everywhere for a course whose cards are the same', () => {
        const course = real('konopiste-radecky')
        const rows = holeRows(course, course.course!.tees.map((tee) => tee.name))

        expect(rows.every((row) => row.parLadies === '')).toBe(true)
    })

    /** Filling one in is how a course gains a women's card at all. */
    it('creates the whole card when one hole is given a different par', () => {
        const course = real('konopiste-radecky')
        const men = course.course!.scorecard.men
        const at = men.findIndex((hole) => hole.par === 4)
        const form = formOf(course)
        form.holes[at]!.parLadies = '5'

        const after = courseFromForm(course, form)
        const ladies = after.course!.scorecard.ladies as { hole: number; par: number; hcp: number }[]

        expect(ladies).toHaveLength(18)
        expect(ladies[at]!.par).toBe(5)
        expect(ladies[at]!.hole).toBe(men[at]!.hole)
        // Every other hole is the men's, which is what "one grid" means.
        expect(ladies.filter((hole, index) => hole.par !== men[index]!.par)).toHaveLength(1)
    })

    /*
     * Typing the men's par into the women's box is agreement, and agreement is
     * what an absent card already says. Eighteen rows repeating the eighteen
     * above them is the duplication this grid exists to avoid.
     */
    it('does not create a card for a women\u2019s par that agrees', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.holes[0]!.parLadies = String(course.course!.scorecard.men[0]!.par)

        expect(courseFromForm(course, form).course?.scorecard.ladies).toBeNull()
    })

    /** And clearing the last difference takes the card away rather than leaving a copy. */
    it('removes the card again when nothing differs', () => {
        const course = real('sandvalley')
        const form = formOf(course)
        for (const row of form.holes) row.parLadies = ''

        expect(courseFromForm(course, form).course?.scorecard.ladies).toBeNull()
    })
})

/*
 * Lengths arrive by the tee's row rather than by its name, because a name is
 * what the same save might be changing.
 */
describe('lengths and a renamed tee', () => {
    it('carries a length across a rename', () => {
        const course = real('konopiste-radecky')
        const before = course.course!.scorecard.men[0]!.lengths as Record<string, number>
        const form = formOf(course)
        form.tees.find((tee) => tee.name === 'Yellow')!.name = 'Gold'

        const after = courseFromForm(course, form)
        const lengths = after.course!.scorecard.men[0]!.lengths as Record<string, number>

        expect(lengths.Gold).toBe(before.Yellow)
        expect(lengths).not.toHaveProperty('Yellow')
    })

    it('writes a length typed into a column', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.holes[0]!.lengths[0] = '999'

        const after = courseFromForm(course, form)

        expect((after.course!.scorecard.men[0]!.lengths as Record<string, number>).Black).toBe(999)
    })

    /** A tee added in the same save can be measured in it, which is the point of the blank column. */
    it('accepts lengths for a tee added in the same save', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        const blank = form.tees.length - 1
        form.tees[blank]!.name = 'Gold'
        form.tees[blank]!.color = '#d4af37'
        form.tees[blank]!.length = '5000'
        form.tees[blank]!.par = '72'
        form.holes[0]!.lengths[blank] = '410'

        const after = courseFromForm(course, form)

        expect(after.course!.tees.map((tee) => tee.name)).toContain('Gold')
        expect((after.course!.scorecard.men[0]!.lengths as Record<string, number>).Gold).toBe(410)
    })

    /** A tee removed takes its column with it, as it already took its lengths. */
    it('drops the column of a tee that was removed', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.tees = form.tees.filter((tee) => tee.name !== 'Red')

        const after = courseFromForm(course, form)

        expect(after.course!.scorecard.men[0]!.lengths).not.toHaveProperty('Red')
        expect((after.course!.scorecard.men[0]!.lengths as Record<string, number>).Black).toBeDefined()
    })
})

describe('the numbers themselves', () => {
    it('keeps a stored hole when a box is emptied rather than writing nothing', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.holes[0]!.par = ''

        const after = courseFromForm(course, form)

        expect(after.course!.scorecard.men[0]!.par).toBe(course.course!.scorecard.men[0]!.par)
    })

    it('refuses a par that is not a number, rather than coercing it', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.holes[0]!.par = 'four'

        expect(courseSchema.safeParse(courseFromForm(course, form)).success).toBe(false)
    })

    it('writes a stroke index somebody changed', () => {
        const course = real('konopiste-radecky')
        const form = formOf(course)
        form.holes[0]!.hcp = '7'

        expect(courseFromForm(course, form).course!.scorecard.men[0]!.hcp).toBe(7)
    })
})
