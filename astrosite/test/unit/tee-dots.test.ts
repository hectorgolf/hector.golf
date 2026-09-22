import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { contrast, parseHex } from '@hector/ui/code/colour.ts'
import { DOT_GROUND, ringFor } from '@hector/ui/code/tee-dots.ts'

import { parseRootTokens, resolveToken } from '../../src/code/palette'

const here = dirname(fileURLToPath(import.meta.url))

const tees = (): { course: string; name: string; color: string }[] => {
    const dir = join(here, '../../src/data/courses')
    return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .flatMap((name) => {
            const course = JSON.parse(readFileSync(join(dir, name), 'utf-8'))
            return (course.course?.tees ?? []).map((tee: { name: string; color: string }) => ({
                course: course.id,
                name: tee.name,
                color: tee.color,
            }))
        })
}

/*
 * The rule itself lives in `@hector/ui` and is tested there. What is checked
 * here is the pair of things that rule depends on and this repository can
 * change underneath it: the colours the courses actually use, and the token the
 * dots are actually drawn on.
 */
describe('the tee dots this site draws', () => {
    it('has tees to check, so a glob mistake cannot make this vacuous', () => {
        expect(tees().length).toBeGreaterThan(70)
    })

    /*
     * The threshold lands in open space rather than on a boundary: the fills
     * sort into a group at 2.17 and below — black and the two blues — and a
     * group from 3.62 up. A tee should not change appearance because somebody
     * nudged a hex by one digit.
     */
    it('decides every committed fill well clear of the threshold', () => {
        const ground = parseHex(DOT_GROUND)

        for (const tee of tees()) {
            const ratio = contrast(parseHex(tee.color), ground)
            expect(
                Math.abs(ratio - 3),
                `${tee.course} ${tee.name} (${tee.color}) sits on the threshold at ${ratio.toFixed(2)}`
            ).toBeGreaterThan(0.5)
        }
    })

    it('never leaves a dot without a ring colour', () => {
        for (const tee of tees()) {
            const ring = ringFor(tee.color)
            expect(ring, `${tee.course} ${tee.name}`).toBeTruthy()
        }
    })

    /*
     * `DOT_GROUND` is a literal because the answer has to be a colour by the
     * time it reaches an SVG attribute. This is what stops it drifting from the
     * stylesheet it was taken from — which both apps load.
     */
    it('uses the colour the scorecard actually sits on', () => {
        const css = readFileSync(join(here, '../../../packages/ui/styles/hector.css'), 'utf-8')

        expect(resolveToken(parseRootTokens(css), '--surface').toLowerCase()).toBe(DOT_GROUND)
    })
})
