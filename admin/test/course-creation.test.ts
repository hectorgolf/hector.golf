import { describe, expect, it } from 'vitest'

import { schema as courseSchema } from '@hector/schemas/src/courses.ts'

import {
    BLANK_NEW_COURSE,
    DEFAULT_PAR,
    newCourseFrom,
    problemsWith,
    suggestId,
    type NewCourseForm,
} from '../src/lib/courses/creation.ts'
import { courseFromForm, formOf } from '../src/lib/courses/details.ts'

const filled = (over: Partial<NewCourseForm> = {}): NewCourseForm => ({
    ...BLANK_NEW_COURSE,
    id: 'new-club-links',
    name: 'New Club — Links',
    homepage: 'https://example.com/golf',
    address: 'Somewhere, Somewhere',
    descriptionShort: 'A course.',
    ...over,
})

describe('what a new course has to say for itself', () => {
    it('is valid against the schema with nothing else filled in', () => {
        expect(courseSchema.safeParse(newCourseFrom(filled())).success).toBe(true)
    })

    it('needs an id, because it is the filename and the public address', () => {
        expect(problemsWith(filled({ id: '' }), false)[0]).toMatch(/An id is needed/)
    })

    it('refuses an id that is not shaped like the seventeen that exist', () => {
        for (const id of ['Konopiste', 'has space', 'trailing-', '-leading', 'double--hyphen', 'uppercase-A']) {
            expect(problemsWith(filled({ id }), false), id).not.toEqual([])
        }
    })

    it('accepts the shapes that do exist', () => {
        for (const id of ['lafinca', 'konopiste-radecky', 'tahko-new-course', 'quellness-beckenbauer']) {
            expect(problemsWith(filled({ id }), false), id).toEqual([])
        }
    })

    /*
     * The one the schema cannot answer and the one that matters most:
     * `saveCourse` writes with `set`, so a taken id would overwrite a course
     * rather than refuse to make one.
     */
    it('refuses an id that is already taken', () => {
        expect(problemsWith(filled(), true)[0]).toMatch(/already a course/)
    })

    it('refuses a hole count no course could have', () => {
        for (const holes of ['0', '19', '-1', '', 'eighteen', '9.5']) {
            expect(problemsWith(filled({ holes }), false), holes).not.toEqual([])
        }
    })

    it('accepts the counts the courses actually have', () => {
        for (const holes of ['9', '14', '18']) {
            expect(problemsWith(filled({ holes }), false), holes).toEqual([])
        }
    })
})

describe('the scaffold a new course starts from', () => {
    it('numbers the holes from one and gives them the commonest par', () => {
        const course = newCourseFrom(filled({ holes: '9' }))
        const men = course.course!.scorecard.men

        expect(men).toHaveLength(9)
        expect(men.map((hole) => hole.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
        expect(men.every((hole) => hole.par === DEFAULT_PAR)).toBe(true)
    })

    /** A permutation, which is what the schema wants, and obviously a placeholder. */
    it('gives every hole a different stroke index', () => {
        const men = newCourseFrom(filled({ holes: '18' })).course!.scorecard.men

        expect(new Set(men.map((hole) => hole.hcp)).size).toBe(18)
    })

    it('starts with no women’s card, like sixteen of the seventeen', () => {
        expect(newCourseFrom(filled()).course!.scorecard.ladies).toBeNull()
    })

    it('starts with empty containers rather than absent ones', () => {
        const course = newCourseFrom(filled())

        expect(course.description_long).toEqual([])
        expect(course.datasources).toEqual([])
        expect(course.images).toEqual({})
    })

    /*
     * The one that makes the editor work afterwards. `courseFromForm` returns
     * early when there is no `course` object, so a course created without one
     * would take a tee, a scorecard and a save, and keep none of them.
     */
    it('can be given a tee immediately, which needs the course object to exist', () => {
        const created = newCourseFrom(filled({ holes: '9' }))
        expect(created.course).toBeDefined()

        const form = formOf(created)
        const blank = form.tees.length - 1
        form.tees[blank]!.name = 'Yellow'
        form.tees[blank]!.color = '#dddd00'
        form.tees[blank]!.length = '5200'
        form.tees[blank]!.par = '36'
        form.holes[0]!.lengths[blank] = '310'

        const after = courseFromForm(created, form)

        expect(after.course!.tees.map((tee) => tee.name)).toEqual(['Yellow'])
        expect((after.course!.scorecard.men[0]!.lengths as Record<string, number>).Yellow).toBe(310)
        expect(courseSchema.safeParse(after).success).toBe(true)
    })

    it('can have its scorecard typed in, which needs the holes to exist', () => {
        const created = newCourseFrom(filled({ holes: '9' }))
        const form = formOf(created)
        form.holes[0]!.par = '5'
        form.holes[0]!.hcp = '3'

        const after = courseFromForm(created, form)

        expect(after.course!.scorecard.men[0]!.par).toBe(5)
        expect(after.course!.scorecard.men[0]!.hcp).toBe(3)
    })
})

describe('suggesting an id from a name', () => {
    it('makes something of the shape an id has to be', () => {
        expect(suggestId('New Club — Links')).toBe('new-club-links')
        expect(suggestId('Konopiště Radecký')).toBe('konopiste-radecky')
        expect(suggestId('  Spaced  Out  ')).toBe('spaced-out')
    })

    /*
     * A suggestion and not a rule. "Diamond Country Club - Park" is
     * `diamondcc-park`, which nothing mechanical produces — somebody who knows
     * the club picks better, and the box is theirs to overwrite.
     */
    it('does not claim to reproduce the ids somebody chose by hand', () => {
        expect(suggestId('Diamond Country Club - Park')).not.toBe('diamondcc-park')
    })
})
