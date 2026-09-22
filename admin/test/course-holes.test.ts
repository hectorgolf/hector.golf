import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { schema as courseSchema, withTeeIds, type Course } from '@hector/schemas/src/courses.ts'

import { courseFromForm, formOf } from '../src/lib/courses/details.ts'
import { holeDescriptionRows, isWide } from '../src/lib/courses/holes.ts'

const here = dirname(fileURLToPath(import.meta.url))
const real = (id: string): Course =>
    withTeeIds(
        courseSchema.parse(
            JSON.parse(readFileSync(join(here, `../../astrosite/src/data/courses/${id}.json`), 'utf-8'))
        ) as Course
    )

/** The thirteen that have hole pages. */
const described = [
    'diamondcc-diamond',
    'emporda-dunes',
    'emporda-forest',
    'konopiste-deste',
    'konopiste-radecky',
    'lafinca',
    'penati-heritage',
    'penati-legend',
    'quellness-beckenbauer',
    'quellness-porsche',
    'tahko-new-course',
    'tahko-old-course',
    'villamartin',
]

/** And the four that do not. */
const undescribed = ['adamstal-championship', 'diamondcc-country', 'diamondcc-park', 'sandvalley']

/*
 * 234 diagrams and 234 pieces of prose, and the diagrams are the half nobody
 * can retype: a hole page 404s without one, and `descriptions.length` is what
 * decides how many hole pages a course has. The editor rebuilds the array from
 * its own boxes, which is the shape of mistake that ate `stroke` off the tees —
 * so the first thing asked of it is that a save which touches nothing changes
 * nothing.
 */
describe('a save that touches nothing keeps the hole descriptions exactly', () => {
    it.each(described)('reproduces every hole of %s', (id) => {
        const course = real(id)

        expect(courseFromForm(course, formOf(course)).course?.descriptions).toEqual(course.course?.descriptions)
    })

    /** Including the Finnish twin, which this form does not show at all. */
    it.each(['tahko-new-course', 'tahko-old-course'])('leaves %s’s local prose untouched', (id) => {
        const course = real(id)
        expect(course.course!.descriptions_local).toHaveLength(18)

        expect(courseFromForm(course, formOf(course)).course?.descriptions_local).toEqual(
            course.course?.descriptions_local
        )
    })

    /** And a course with no hole pages does not grow any by being opened. */
    it.each(undescribed)('leaves %s without hole descriptions', (id) => {
        const course = real(id)

        expect(courseFromForm(course, formOf(course)).course?.descriptions ?? null).toBeNull()
    })
})

describe('editing a hole', () => {
    it('writes the prose somebody typed', () => {
        const course = real('lafinca')
        const form = formOf(course)
        form.descriptions[2]!.text = '  Blind tee shot over the ridge.  '

        const after = courseFromForm(course, form)

        expect(after.course!.descriptions![2]!.description).toBe('Blind tee shot over the ridge.')
    })

    it('leaves the other seventeen alone', () => {
        const course = real('lafinca')
        const form = formOf(course)
        form.descriptions[2]!.text = 'Changed.'

        const after = courseFromForm(course, form)

        expect(after.course!.descriptions!.filter((hole, index) =>
            hole.description !== course.course!.descriptions![index]!.description
        )).toHaveLength(1)
    })

    /*
     * An empty diagram box means "unchanged", not "remove it". The schema
     * requires a layout, so a hole without one is not a state the record can
     * hold or the page can render.
     */
    it('keeps the diagram when nothing was chosen', () => {
        const course = real('lafinca')
        const form = formOf(course)
        form.descriptions[0]!.url = undefined
        form.descriptions[0]!.object = undefined

        const after = courseFromForm(course, form)

        expect(after.course!.descriptions![0]!.layout).toEqual(course.course!.descriptions![0]!.layout)
    })

    it('replaces the diagram with an uploaded one', () => {
        const course = real('lafinca')
        const form = formOf(course)
        form.descriptions[0]!.object = 'courses/lafinca/abc123.png'

        const after = courseFromForm(course, form)

        expect(after.course!.descriptions![0]!.layout).toEqual({ object: 'courses/lafinca/abc123.png' })
        expect(after.course!.descriptions![0]!.layout).not.toHaveProperty('url')
    })

    it('shows a stored diagram in the row it belongs to', () => {
        const course = real('tahko-old-course')
        const rows = holeDescriptionRows(course)

        expect(rows).toHaveLength(18)
        expect(rows[0]!.hole).toBe(1)
        expect(rows[0]!.url).toBe('/images/courses/tahko-old-course/holes/1.png')
        expect(rows[0]!.text).toContain('Straight and long drive')
    })
})

/*
 * `shape` is one answer for the course wearing eighteen hats: `/courses/[slug]`
 * reads `descriptions[0].shape` and nothing else, uses it for the whole grid,
 * and the four courses that set it set it on all eighteen holes, always `wide`.
 */
describe('whether the diagrams are wide', () => {
    it('reads the course, not the hole', () => {
        expect(isWide(real('tahko-old-course'))).toBe(true)
        expect(isWide(real('lafinca'))).toBe(false)
    })

    it('puts it on every hole when it is turned on', () => {
        const course = real('lafinca')
        expect(course.course!.descriptions!.some((hole) => hole.shape)).toBe(false)

        const after = courseFromForm(course, { ...formOf(course), wideLayouts: true })

        expect(after.course!.descriptions!.every((hole) => hole.shape === 'wide')).toBe(true)
    })

    /** And takes it off every hole, rather than leaving the key present and empty. */
    it('removes it from every hole when it is turned off', () => {
        const course = real('tahko-old-course')
        const after = courseFromForm(course, { ...formOf(course), wideLayouts: false })

        expect(after.course!.descriptions!.some((hole) => 'shape' in hole)).toBe(false)
        expect(courseSchema.safeParse(after).success).toBe(true)
    })
})
