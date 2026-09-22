import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { contrast, parseHex, parseRootTokens, resolveToken } from '../../src/code/palette'
import { DOT_GROUND, RING, ringFor } from '../../src/code/tee-dots'

const here = dirname(fileURLToPath(import.meta.url))
const courses = (): { id: string; tees: { name: string; color: string }[] }[] => {
    const dir = join(here, '../../src/data/courses')
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf-8')))
        .map((course) => ({ id: course.id, tees: course.course?.tees ?? [] }))
}

/*
 * The ring around a tee's dot, which used to be a field on every tee and is now
 * worked out from the fill and the page.
 *
 * Being a field is what let it be wrong: eighteen of the twenty tees that set
 * one set `#000000`, which against this page is a contrast of 1.13 to 1 — a
 * ring nobody could see, on a site nobody could see it on, for as long as it
 * existed.
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
     * Never omitted and never black. Both would change how big the dot looks:
     * one drops a pixel of ring, the other paints it the colour of the page.
     */
    it('is never black and never nothing', () => {
        for (const { tees } of courses()) {
            for (const tee of tees) {
                const ring = ringFor(tee.color)
                expect(ring).toBeTruthy()
                expect(ring.toLowerCase()).not.toBe('#000000')
            }
        }
    })

    /** `color` is a free string on the schema, so it is not always a hex. */
    it('falls back to white for a fill it cannot read', () => {
        expect(ringFor('rebeccapurple')).toBe(RING)
        expect(ringFor('')).toBe(RING)
    })

    /*
     * The threshold lands in open space rather than on a boundary: across the
     * committed courses the fills sort into a group at 2.17 and below and a
     * group from 3.62 up. A tee should not change appearance because somebody
     * nudged a hex by one digit.
     */
    it('decides every committed fill well clear of the line', () => {
        const ground = parseHex(DOT_GROUND)
        for (const { id, tees } of courses()) {
            for (const tee of tees) {
                const ratio = contrast(parseHex(tee.color), ground)
                expect(Math.abs(ratio - 3), `${id} ${tee.name} (${tee.color}) sits on the threshold`).toBeGreaterThan(0.5)
            }
        }
    })

    /*
     * The ground is a literal here because the answer has to be a colour by the
     * time it reaches an SVG attribute. This is what stops it drifting from the
     * stylesheet it was copied from.
     */
    it('uses the colour the scorecard actually sits on', () => {
        const css = readFileSync(join(here, '../../../packages/ui/styles/hector.css'), 'utf-8')
        const tokens = parseRootTokens(css)

        expect(resolveToken(tokens, '--surface').toLowerCase()).toBe(DOT_GROUND)
    })
})
