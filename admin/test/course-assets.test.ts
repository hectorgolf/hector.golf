import { describe, expect, it } from 'vitest'

import {
    referencedObjects,
    uploadedImagePath,
    withPublishedImages,
    type Course,
} from '@hector/schemas/src/courses.ts'

import { IMAGE_TYPES, assetName } from '../src/lib/assets.ts'

/**
 * The translation between what the store holds and what git gets.
 *
 * An uploaded image lives in the asset bucket and the Firestore document names
 * the object. The committed file must never mention it: the site reads `url`
 * and has done since long before any of this, so keeping `object` out of the
 * file is what lets none of the site change. It is the same division tee ids
 * already have — see `docs/plans/courses-in-the-admin.md`, step 5.
 */

const course = (parts: Course['description_long']): Course =>
    ({
        id: 'test-course',
        name: 'Test',
        homepage: 'https://example.com',
        contact: { address: 'Somewhere' },
        description_short: 'Short.',
        description_long: parts,
        images: {},
        datasources: [],
    }) as Course

describe('naming an uploaded object', () => {
    /**
     * A digest of the bytes rather than a random id, which buys two things: the
     * same picture uploaded twice is the same object, and — because the export
     * names the committed file after the object — an unchanged image produces
     * no diff. A random id would rewrite a file in git every time somebody
     * re-picked the same photograph.
     */
    it('is the same for the same bytes, and different for different ones', () => {
        const bytes = new Uint8Array([1, 2, 3, 4])
        expect(assetName('courses', 'x', bytes, 'jpg')).toBe(assetName('courses', 'x', bytes, 'jpg'))
        expect(assetName('courses', 'x', new Uint8Array([9]), 'jpg')).not.toBe(
            assetName('courses', 'x', bytes, 'jpg')
        )
    })

    it('is prefixed by the collection and the record, which is what shares the bucket', () => {
        const name = assetName('courses', 'konopiste-radecky', new Uint8Array([1]), 'jpg')
        expect(name.startsWith('courses/konopiste-radecky/')).toBe(true)
        expect(name.endsWith('.jpg')).toBe(true)
    })

    it('normalises the extension rather than trusting it', () => {
        expect(assetName('courses', 'x', new Uint8Array([1]), '.JPG').endsWith('.jpg')).toBe(true)
    })

    /**
     * SVG is absent on purpose. It is a document that can carry script, and
     * whatever this accepts is written into a directory the public site serves
     * verbatim.
     */
    it('accepts no type that the site would serve as a document', () => {
        expect(Object.keys(IMAGE_TYPES)).not.toContain('image/svg+xml')
        expect(Object.values(IMAGE_TYPES)).not.toContain('svg')
    })
})

describe('what the export publishes', () => {
    it('turns an object into the path the site reads, and drops the object', () => {
        const stored = course([{ type: 'image', object: 'courses/test-course/abc123.jpg' }])
        const published = withPublishedImages(stored)

        expect(published.description_long).toEqual([
            { type: 'image', url: '/images/courses/test-course/uploaded/abc123.jpg' },
        ])
        expect(JSON.stringify(published)).not.toContain('object')
    })

    it('leaves an image that was already committed exactly as it is', () => {
        const stored = course([{ type: 'image', url: '/images/courses/test-course/hero1.jpg' }])
        expect(withPublishedImages(stored).description_long).toEqual(stored.description_long)
    })

    it('leaves paragraphs alone', () => {
        const stored = course([{ type: 'paragraph', content: 'Words.' }])
        expect(withPublishedImages(stored).description_long).toEqual(stored.description_long)
    })

    /**
     * What the export keeps. Everything else in the course's `uploaded/`
     * directory is deleted, so this list being wrong in the small direction
     * deletes a published picture.
     */
    it('names every object a course references, and nothing else', () => {
        const stored = course([
            { type: 'paragraph', content: 'Words.' },
            { type: 'image', object: 'courses/test-course/aaa.jpg' },
            { type: 'image', url: '/images/courses/test-course/legacy.jpg' },
            { type: 'image', object: 'courses/test-course/bbb.png' },
        ])

        expect(referencedObjects(stored)).toEqual([
            'courses/test-course/aaa.jpg',
            'courses/test-course/bbb.png',
        ])
    })

    it('publishes into a directory the export owns, under the course', () => {
        expect(uploadedImagePath('konopiste-radecky', 'courses/konopiste-radecky/abc.jpg')).toBe(
            '/images/courses/konopiste-radecky/uploaded/abc.jpg'
        )
    })
})
