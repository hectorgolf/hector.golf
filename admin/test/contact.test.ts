import { describe, expect, it } from 'vitest'

import { telHref, telText } from '../src/lib/contact.ts'

/*
 * Every spelling below is one the 17 committed courses actually use. The point
 * of the list is that there are four of them: the field has never been
 * validated beyond "a string", so the page has to cope rather than assume.
 */
describe('a phone number on the course page', () => {
    it('dials a bare international number', () => {
        expect(telHref('+4327643500')).toBe('tel:+4327643500')
        expect(telText('+4327643500')).toBe('+4327643500')
    })

    it('drops a tel: scheme somebody stored', () => {
        expect(telHref('tel:+43227520075')).toBe('tel:+43227520075')
        expect(telText('tel:+43227520075')).toBe('+43227520075')
    })

    /*
     * The common spelling here, and the one that matters. `tel` is not a
     * hierarchical scheme, so in `tel://+43...` the `//` starts an authority and
     * the number is parsed as a host.
     */
    it('drops a tel:// scheme, which is not a working href', () => {
        expect(telHref('tel://+43227520075')).toBe('tel:+43227520075')
        expect(telText('tel://+43227520075')).toBe('+43227520075')
    })

    it('leaves somebody formatting of their own number alone', () => {
        expect(telText('tel://+358 9 123 4567')).toBe('+358 9 123 4567')
        expect(telHref('+358 (0)9 123')).toBe('tel:+358 (0)9 123')
    })

    it('has nothing to offer for a course with no phone', () => {
        expect(telHref(undefined)).toBeUndefined()
        expect(telText(undefined)).toBeUndefined()
        expect(telHref('')).toBeUndefined()
        expect(telHref('   ')).toBeUndefined()
    })

    /** A scheme and nothing after it is not a number. */
    it('has nothing to offer for a scheme with no number', () => {
        expect(telHref('tel://')).toBeUndefined()
        expect(telText('tel:')).toBeUndefined()
    })
})
