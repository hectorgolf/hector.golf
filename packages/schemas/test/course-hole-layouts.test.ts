import { describe, expect, it } from 'vitest'

import { imageUrl, referencedObjects, schema, withPublishedImages, type Course } from '../src/courses.ts'

/*
 * A hole's `layout` — the diagram the hole page leads with — as a picture
 * rather than a path.
 *
 * It was a bare string on all 270 of them, which is fine for the files somebody
 * put under `astrosite/public/images/courses/{id}/holes/` by hand and no use
 * for one somebody uploads: an upload is an object in a bucket until the export
 * fetches it, and there is no path to write down yet. So it becomes the shape
 * the hero image and the description images already have.
 *
 * The records in Firestore still carry the string, and nothing rewrites them on
 * a schedule — courses are owned there. A schema that refused them would take
 * every hole page down on deploy.
 */
const hole = (over: Record<string, unknown> = {}) => ({
    hole: 1,
    layout: { url: '/images/courses/x/holes/1.png' },
    description: '',
    ...over,
})

const course = (over: Partial<Course> = {}): Course =>
    schema.parse({
        id: 'test-course',
        name: 'Test Course',
        homepage: 'https://example.com',
        contact: { address: 'Somewhere' },
        description_short: 'Short.',
        description_long: [],
        images: {},
        datasources: [],
        course: {
            tees: [],
            scorecard: { men: [], ladies: null },
            descriptions: [hole()],
        },
        ...over,
    })

describe('a hole layout', () => {
    it('is a picture with a url', () => {
        expect(course().course!.descriptions![0]!.layout).toEqual({ url: '/images/courses/x/holes/1.png' })
    })

    it('can be an uploaded object instead, which has no url yet', () => {
        const layout = { object: 'courses/x/abc123.png' }
        const parsed = course({
            course: { tees: [], scorecard: { men: [], ladies: null }, descriptions: [hole({ layout })] },
        } as unknown as Partial<Course>)

        expect(parsed.course!.descriptions![0]!.layout).toEqual(layout)
        expect(imageUrl(parsed.course!.descriptions![0]!.layout)).toBeUndefined()
    })

    /*
     * All 270 stored layouts are bare strings, in Firestore as well as in the
     * files. Refusing them would take down every hole page on the deploy that
     * introduced this.
     */
    it('is still accepted as the bare string every stored hole carries', () => {
        const parsed = course({
            course: {
                tees: [],
                scorecard: { men: [], ladies: null },
                descriptions: [hole({ layout: '/images/courses/x/holes/1.png' })],
            },
        } as unknown as Partial<Course>)

        expect(parsed.course!.descriptions![0]!.layout).toEqual({ url: '/images/courses/x/holes/1.png' })
    })

    /** Required, unlike the hero: a hole page without its diagram is not a hole page. */
    it('cannot be left out', () => {
        const without = { hole: 2, description: '' }
        expect(
            schema.safeParse({
                ...course(),
                course: { tees: [], scorecard: { men: [], ladies: null }, descriptions: [without] },
            }).success
        ).toBe(false)
    })
})

describe('publishing an uploaded layout', () => {
    const uploaded = (): Course =>
        course({
            id: 'tahko-old-course',
            course: {
                tees: [],
                scorecard: { men: [], ladies: null },
                descriptions: [hole({ layout: { object: 'courses/tahko-old-course/9f8e7d6c5b4a3210.png' } })],
                descriptions_local: [hole({ layout: { object: 'courses/tahko-old-course/0123456789abcdef.png' } })],
            },
        } as unknown as Partial<Course>)

    it('becomes the path the export wrote it to', () => {
        const published = withPublishedImages(uploaded())

        expect(published.course!.descriptions![0]!.layout).toEqual({
            url: '/images/courses/tahko-old-course/uploaded/9f8e7d6c5b4a3210.png',
        })
        expect(published.course!.descriptions![0]!.layout).not.toHaveProperty('object')
    })

    /** The local set too, which is a second array nothing on the site reads yet. */
    it('publishes the local twin as well', () => {
        const published = withPublishedImages(uploaded())

        expect(published.course!.descriptions_local![0]!.layout).toEqual({
            url: '/images/courses/tahko-old-course/uploaded/0123456789abcdef.png',
        })
    })

    it('leaves a layout that is already a committed file alone', () => {
        const published = withPublishedImages(course())

        expect(published.course!.descriptions![0]!.layout).toEqual({ url: '/images/courses/x/holes/1.png' })
    })

    /*
     * The export deletes everything in `uploaded/` that nothing references, so
     * a layout missing from this list is a hole diagram deleted on the next
     * export — quietly, and only for the courses whose diagrams are uploads.
     */
    it('counts towards the objects the export must fetch and keep', () => {
        expect(referencedObjects(uploaded()).sort()).toEqual([
            'courses/tahko-old-course/0123456789abcdef.png',
            'courses/tahko-old-course/9f8e7d6c5b4a3210.png',
        ])
    })

    it('contributes nothing when every layout is a committed file', () => {
        expect(referencedObjects(course())).toEqual([])
    })

    it('leaves a course with no hole descriptions alone', () => {
        const bare = course({ course: { tees: [], scorecard: { men: [], ladies: null } } } as unknown as Partial<Course>)

        expect(withPublishedImages(bare).course!.descriptions).toBeUndefined()
        expect(referencedObjects(bare)).toEqual([])
    })
})
