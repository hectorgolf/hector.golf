import { describe, expect, it } from 'vitest'

import { imageUrl, referencedObjects, schema, withPublishedImages, type Course } from '../src/courses.ts'

/*
 * `hero_image` as a picture rather than a path.
 *
 * It was a bare string, which is fine for a file somebody committed and no use
 * at all for one somebody uploads: an upload is an object in a bucket until the
 * export fetches it, and there is no path to write down yet. So it became the
 * same shape a description's image has — `url` once committed, `object` while
 * it is only in the bucket — and the export turns one into the other for both.
 *
 * The hard part is not the shape. It is that courses are owned by Firestore
 * now, so the records that exist were written before this and carry the string.
 * They have to keep working, on the deploy that introduces this and every one
 * after, until something rewrites them.
 */

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
        ...over,
    })

describe('a hero image', () => {
    it('is a picture with a url', () => {
        expect(course({ hero_image: { url: '/images/courses/x/hero.jpg' } }).hero_image).toEqual({
            url: '/images/courses/x/hero.jpg',
        })
    })

    it('can be an uploaded object instead, which has no url yet', () => {
        const hero = course({ hero_image: { object: 'courses/x/abc123.jpg' } }).hero_image

        expect(hero).toEqual({ object: 'courses/x/abc123.jpg' })
        expect(imageUrl(hero)).toBeUndefined()
    })

    /*
     * The records in Firestore, written before the shape changed. Courses are
     * owned there, so nothing rewrites them on a schedule — a schema that
     * refused them would take every course page down on deploy and leave it
     * down until somebody ran a migration.
     */
    it('is still accepted as the bare string every stored course carries', () => {
        expect(course({ hero_image: '/images/courses/x/hero.jpg' as never }).hero_image).toEqual({
            url: '/images/courses/x/hero.jpg',
        })
    })

    it('is still optional, because a course may have no hero at all', () => {
        expect(course().hero_image).toBeUndefined()
    })

    /** Not every string: the rule that kept a typo out of `url` still applies. */
    it('refuses something that is neither a url nor an image path', () => {
        expect(schema.safeParse({ ...course(), hero_image: 'hero.jpg' }).success).toBe(false)
        expect(schema.safeParse({ ...course(), hero_image: { url: 'hero.jpg' } }).success).toBe(false)
    })
})

describe('publishing an uploaded hero', () => {
    const uploaded = course({
        id: 'penati-legend',
        hero_image: { object: 'courses/penati-legend/9f8e7d6c5b4a3210.jpg' },
        description_long: [{ type: 'image', object: 'courses/penati-legend/0123456789abcdef.png' }],
    })

    /** What the committed file carries: `url`, never `object` — same as a description image. */
    it('becomes the path the export wrote it to', () => {
        const published = withPublishedImages(uploaded)

        expect(published.hero_image).toEqual({
            url: '/images/courses/penati-legend/uploaded/9f8e7d6c5b4a3210.jpg',
        })
        expect(published.hero_image).not.toHaveProperty('object')
    })

    it('leaves a hero that is already published alone', () => {
        const committed = course({ hero_image: { url: '/images/courses/x/hero.jpg' } })

        expect(withPublishedImages(committed).hero_image).toEqual({ url: '/images/courses/x/hero.jpg' })
    })

    it('leaves a course with no hero alone', () => {
        expect(withPublishedImages(course()).hero_image).toBeUndefined()
    })

    /*
     * The export deletes everything in `uploaded/` that nothing references, so
     * a hero missing from this list is a hero deleted on the next export —
     * quietly, and only for courses whose hero happens to be an upload.
     */
    it('counts towards the objects the export must fetch and keep', () => {
        expect(referencedObjects(uploaded)).toEqual([
            'courses/penati-legend/0123456789abcdef.png',
            'courses/penati-legend/9f8e7d6c5b4a3210.jpg',
        ])
    })

    it('contributes nothing when the hero is already a committed file', () => {
        expect(referencedObjects(course({ hero_image: { url: '/images/x/hero.jpg' } }))).toEqual([])
    })
})
