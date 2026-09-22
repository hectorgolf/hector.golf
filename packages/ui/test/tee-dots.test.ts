import { describe, expect, it } from 'vitest'

import { contrast, parseHex } from '../code/colour.ts'
import { DOT_GROUND, DOT_STROKE_WIDTH, RING, ringFor } from '../code/tee-dots.ts'

/*
 * The ring around a tee's dot, which used to be a field on every tee and is now
 * worked out from the fill and the page.
 *
 * Being a field is what let it be wrong: eighteen of the twenty tees that set
 * one set `#000000`, which against this ground is a contrast of 1.13 to 1 — a
 * ring nobody could see, for as long as it existed.
 */
describe('the ring around a tee dot', () => {
    it('is white when the fill does not separate from the page', () => {
        expect(ringFor('#000000')).toBe(RING)
        expect(ringFor('#0000ff')).toBe(RING)
        expect(ringFor('#0000dd')).toBe(RING)
    })

    it('is the fill itself when it does', () => {
        expect(ringFor('#ffffff')).toBe('#ffffff')
        expect(ringFor('#ffff00')).toBe('#ffff00')
        expect(ringFor('#ff0000')).toBe('#ff0000')
        expect(ringFor('#ffa500')).toBe('#ffa500')
    })

    /*
     * Never omitted and never black. Both would change how big the dot looks —
     * one drops a unit of ring, the other paints it the colour of the page —
     * and a dot that looks smaller than the one beside it reads as a difference
     * in the data rather than in the drawing.
     */
    it('is never black, and there is always one', () => {
        for (const fill of ['#000000', '#0000ff', '#ffffff', '#ffff00', '#dd0000', '#88a2b4', '#437e4f']) {
            expect(ringFor(fill)).toBeTruthy()
            expect(ringFor(fill).toLowerCase()).not.toBe('#000000')
        }
        expect(DOT_STROKE_WIDTH).toBe(1)
    })

    /** `color` is a free string on the schema, so it is not always a hex. */
    it('falls back to white for a fill it cannot read', () => {
        expect(ringFor('rebeccapurple')).toBe(RING)
        expect(ringFor('')).toBe(RING)
        expect(ringFor('#12')).toBe(RING)
    })

    it('reads a three-digit hex the way CSS does', () => {
        expect(ringFor('#fff')).toBe('#fff')
        expect(ringFor('#000')).toBe(RING)
    })

    /** Against a light ground the answers turn over, which is the rule working. */
    it('answers for whatever ground it is given', () => {
        expect(ringFor('#ffffff', '#ffffff')).toBe(RING)
        expect(ringFor('#000000', '#ffffff')).toBe('#000000')
    })

    it('puts the two ring colours far apart against the ground it uses', () => {
        const ground = parseHex(DOT_GROUND)

        expect(contrast(parseHex(RING), ground)).toBeGreaterThan(15)
        expect(contrast(parseHex('#000000'), ground)).toBeLessThan(1.5)
    })
})
