import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { schema as courseSchema, type Course } from '@hector/schemas/src/courses.ts'

import { KNOWN_DATASOURCES, datasourceRows, datasourcesFrom } from '../src/lib/courses/datasources.ts'
import { courseFromForm, formOf } from '../src/lib/courses/details.ts'

const here = dirname(fileURLToPath(import.meta.url))
const courseFile = (id: string): Course =>
    courseSchema.parse(JSON.parse(readFileSync(join(here, `../../astrosite/src/data/courses/${id}.json`), 'utf8')))

/*
 * A datasource is a `{ name, url }` pair whose name comes from a short list and
 * whose url is different every time — which is why the editor is a url box per
 * name rather than the checkbox per name it looks like it should be.
 */
describe('the datasource rows a course shows', () => {
    it("puts the course's own sources first, in their own order", () => {
        const course = courseFile('diamondcc-park')
        const rows = datasourceRows(course)

        expect(rows.slice(0, course.datasources.length)).toEqual(
            course.datasources.map((source) => ({ name: source.name, url: source.url, unused: false }))
        )
    })

    it('offers every unused name after them, with nothing in the box', () => {
        const rows = datasourceRows(courseFile('diamondcc-park'))
        const offered = rows.filter((row) => row.unused)

        expect(offered.every((row) => row.url === '')).toBe(true)
        expect(offered.map((row) => row.name)).toEqual(
            KNOWN_DATASOURCES.filter((name) => !courseFile('diamondcc-park').datasources.some((s) => s.name === name))
        )
    })

    /*
     * The one that would lose data. `courseFromForm` overwrites `datasources`
     * with whatever the form carried, so a name this file declined to render is
     * a source deleted by opening the editor and pressing Save.
     */
    it('renders a name that is not in the list, because the course has one', () => {
        const course = { ...courseFile('diamondcc-park'), datasources: [{ name: 'a club secretary', url: 'https://example.com/x' }] }
        const rows = datasourceRows(course)

        expect(rows[0]).toEqual({ name: 'a club secretary', url: 'https://example.com/x', unused: false })
        expect(datasourcesFrom(rows)).toEqual(course.datasources)
    })
})

/*
 * `slope table` was retired from the vocabulary on 2026-09-22 in favour of
 * `official slope table`: the same thing spelled twice, two courses using one
 * and one the other, none using both, all three pointing at a PDF on the club's
 * own site.
 *
 * Retiring a name is only safe because a course carrying it keeps it. The two
 * that still do are renamed by moving a URL from one box to the next in the
 * editor, which is the point of having an editor — not by a migration, and not
 * by editing the committed files, which Firestore owns and the export would
 * overwrite.
 */
describe('a name that has been retired from the list', () => {
    const emporda = (): Course => ({
        ...courseFile('emporda-dunes'),
        datasources: [
            { name: 'website', url: 'https://www.empordagolf.com/' },
            { name: 'slope table', url: 'https://www.empordagolf.com/storage/golf/links/pdf/2/links.pdf' },
        ],
    })

    it('is not offered to a course that does not have it', () => {
        expect(KNOWN_DATASOURCES).not.toContain('slope table')
        expect(datasourceRows(courseFile('diamondcc-park')).map((row) => row.name)).not.toContain('slope table')
    })

    it('is kept, shown and saved for a course that does', () => {
        const rows = datasourceRows(emporda())

        expect(rows.find((row) => row.name === 'slope table')?.url).toBe(
            'https://www.empordagolf.com/storage/golf/links/pdf/2/links.pdf'
        )
        expect(datasourcesFrom(rows)).toEqual(emporda().datasources)
    })

    /** And the new name is offered beside it, which is how the rename gets done. */
    it('is offered alongside the name that replaced it', () => {
        const rows = datasourceRows(emporda())

        expect(rows.find((row) => row.name === 'official slope table')).toEqual({
            name: 'official slope table',
            url: '',
            unused: true,
        })
    })
})

describe('what the datasource rows save', () => {
    const rows = [
        { name: 'website', url: 'https://example.com', unused: false },
        { name: 'mscorecard', url: 'https://mscorecard.example/1', unused: false },
        { name: 'local rules', url: '', unused: true },
    ]

    it('keeps the filled ones, in the order they appear', () => {
        expect(datasourcesFrom(rows)).toEqual([
            { name: 'website', url: 'https://example.com' },
            { name: 'mscorecard', url: 'https://mscorecard.example/1' },
        ])
    })

    /** Clearing the box is the whole of "remove this source". */
    it('drops one whose url has been cleared', () => {
        const cleared = rows.map((row) => (row.name === 'website' ? { ...row, url: '  ' } : row))

        expect(datasourcesFrom(cleared).map((source) => source.name)).toEqual(['mscorecard'])
    })

    it('adds one whose box has been filled in', () => {
        const filled = rows.map((row) => (row.name === 'local rules' ? { ...row, url: 'https://x.example/r.pdf' } : row))

        expect(datasourcesFrom(filled).map((source) => source.name)).toEqual([
            'website',
            'mscorecard',
            'local rules',
        ])
    })
})

/*
 * The property that keeps the export quiet: editing a course and saving it
 * without touching this section must reproduce the list byte for byte, order
 * included. Every one of the 17, because the orders differ between them.
 */
describe('a save that touches nothing', () => {
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

    it.each(ids)('leaves %s’s datasources exactly as they were', (id) => {
        const course = courseFile(id)

        expect(courseFromForm(course, formOf(course)).datasources).toEqual(course.datasources)
    })
})
