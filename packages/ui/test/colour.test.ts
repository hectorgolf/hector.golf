import { describe, expect, it } from 'vitest'

import { increaseLuminance, luminance } from '../code/colour.ts'

const linearize = (value: number): number => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

describe('increaseLuminance', () => {
    it('gives black a neutral direction to increase luminance', () => {
        expect(increaseLuminance({ r: 0, g: 0, b: 0 }, 0.2)).toEqual({ r: 124, g: 124, b: 124 })
    })

    it('raises luminance by the requested amount without changing channel ratios', () => {
        const original = { r: 40, g: 80, b: 120 }
        const result = increaseLuminance(original, 0.2)

        expect(luminance(result) / luminance(original)).toBeCloseTo(1.2, 1)
        expect(linearize(result.r) / linearize(result.g)).toBeCloseTo(
            linearize(original.r) / linearize(original.g),
            2,
        )
        expect(linearize(result.g) / linearize(result.b)).toBeCloseTo(
            linearize(original.g) / linearize(original.b),
            1,
        )
    })

    it('limits the increase at the sRGB gamut boundary', () => {
        const original = { r: 240, g: 80, b: 40 }
        const result = increaseLuminance(original, 0.2)

        expect(result).toEqual({ r: 255, g: 86, b: 43 })
        expect(result.r).toBeLessThanOrEqual(255)
        expect(result.g).toBeLessThanOrEqual(255)
        expect(result.b).toBeLessThanOrEqual(255)
    })
})