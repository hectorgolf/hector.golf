import { expect, describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
	parseRootTokens,
	resolveToken,
	parseHex,
	luminance,
	contrast,
	hue,
	toHex,
	describeToken,
} from '../../src/code/palette'

const stylesheet = readFileSync('src/styles/hector.css', 'utf-8')

describe('parseRootTokens', () => {
	it('reads the custom properties out of the real stylesheet', () => {
		const tokens = parseRootTokens(stylesheet)

		expect(tokens['--ink-950']).toBe('#0a0a0c')
		expect(tokens['--gold-400']).toBe('#e3b341')
		// Semantic tokens keep their reference; resolveToken is what follows it.
		expect(tokens['--hector']).toBe('var(--gold-400)')
	})

	it('ignores comments, which contain colons and semicolons of their own', () => {
		const css = `:root {
			/* Ember — Matchplay. Holds ~6:1 on the ground; do not use as gold. */
			--ember-400: #ee6a35;
		}`

		expect(parseRootTokens(css)).toEqual({ '--ember-400': '#ee6a35' })
	})

	it('complains when there is no :root block to read', () => {
		expect(() => parseRootTokens('.card { color: red; }')).toThrow(/no :root block/i)
	})
})

describe('resolveToken', () => {
	const tokens = { '--a': 'var(--b)', '--b': 'var(--c)', '--c': '#123456', '--loop': 'var(--loop)' }

	it('follows a chain of references to the value at the end', () => {
		expect(resolveToken(tokens, '--a')).toBe('#123456')
	})

	it('returns a direct value untouched', () => {
		expect(resolveToken(tokens, '--c')).toBe('#123456')
	})

	it('refuses to loop forever', () => {
		expect(() => resolveToken(tokens, '--loop')).toThrow(/cyclic/i)
	})

	it('names the token it could not find', () => {
		expect(() => resolveToken(tokens, '--nope')).toThrow(/--nope/)
	})
})

describe('parseHex', () => {
	it('reads six-digit hex', () => {
		expect(parseHex('#ee6a35')).toEqual({ r: 238, g: 106, b: 53 })
	})

	it('expands three-digit shorthand', () => {
		expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
	})

	it('round-trips through toHex', () => {
		expect(toHex(parseHex('#7ac74f'))).toBe('#7ac74f')
	})

	it('rejects anything that is not a hex colour', () => {
		expect(() => parseHex('rebeccapurple')).toThrow(/not a hex colour/i)
	})
})

describe('contrast', () => {
	it('matches the WCAG extremes', () => {
		const white = { r: 255, g: 255, b: 255 }
		const black = { r: 0, g: 0, b: 0 }

		expect(contrast(white, black)).toBeCloseTo(21, 1)
		expect(contrast(white, white)).toBeCloseTo(1, 5)
	})

	it('does not care which way round the pair is given', () => {
		const a = parseHex('#e3b341')
		const b = parseHex('#0a0a0c')

		expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10)
	})

	it('puts luminance in the expected order for the ink scale', () => {
		expect(luminance(parseHex('#f7f7fa'))).toBeGreaterThan(luminance(parseHex('#0a0a0c')))
	})
})

describe('hue', () => {
	it('places the primaries', () => {
		expect(hue({ r: 255, g: 0, b: 0 })).toBeCloseTo(0, 5)
		expect(hue({ r: 0, g: 255, b: 0 })).toBeCloseTo(120, 5)
		expect(hue({ r: 0, g: 0, b: 255 })).toBeCloseTo(240, 5)
	})

	it('reports no hue for any step of the ink scale, bias and all', () => {
		const tokens = parseRootTokens(stylesheet)
		const inks = Object.keys(tokens).filter((token) => /^--ink-\d+$/.test(token))

		expect(inks.length).toBeGreaterThan(5)
		for (const token of inks) {
			expect(hue(parseHex(resolveToken(tokens, token))), token).toBeUndefined()
		}
	})

	it('still reports a hue for the dimmest colour in the palette', () => {
		const tokens = parseRootTokens(stylesheet)

		expect(hue(parseHex(resolveToken(tokens, '--violet-950')))).toBeDefined()
	})

	it('separates the three competition colours by a wide margin', () => {
		const tokens = parseRootTokens(stylesheet)
		const of = (token: string) => hue(parseHex(resolveToken(tokens, token)))!

		const gold = of('--hector')
		const fairway = of('--victor')
		const ember = of('--matchplay')

		expect(gold).toBeGreaterThan(30)
		expect(gold).toBeLessThan(55)
		expect(fairway).toBeGreaterThan(80)
		expect(ember).toBeLessThan(30)

		// Each pair has to stay far enough apart to tell three trophies apart at a glance.
		for (const [a, b] of [
			[gold, fairway],
			[gold, ember],
			[fairway, ember],
		]) {
			expect(Math.abs(a - b)).toBeGreaterThan(20)
		}
	})
})

describe('the palette the site actually ships', () => {
	const tokens = parseRootTokens(stylesheet)

	it('resolves every competition token to a real colour', () => {
		for (const token of [
			'--hector',
			'--hector-soft',
			'--victor',
			'--victor-soft',
			'--matchplay',
			'--matchplay-soft',
		]) {
			expect(() => describeToken(tokens, token)).not.toThrow()
		}
	})

	it('keeps every competition colour legible on the page ground', () => {
		for (const token of ['--hector', '--victor', '--matchplay']) {
			expect(describeToken(tokens, token).contrast).toBeGreaterThanOrEqual(4.5)
		}
	})

	it('keeps the three par colours reading as one set', () => {
		const ratios = ['--rose-400', '--ink-300', '--sky-300'].map(
			(token) => describeToken(tokens, token).contrast
		)

		// The old level-par colour sat at 17:1 and drowned out the other two.
		expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(6)
	})

	it('keeps Victor clear of the emerald that means "live"', () => {
		const victor = hue(parseHex(resolveToken(tokens, '--victor')))!
		const live = hue(parseHex(resolveToken(tokens, '--emerald-400')))!

		expect(Math.abs(victor - live)).toBeGreaterThan(40)
	})

	it('never lets violet stand for a competition', () => {
		const violets = Object.keys(tokens)
			.filter((token) => token.startsWith('--violet-'))
			.map((token) => resolveToken(tokens, token))

		for (const token of ['--hector', '--victor', '--matchplay']) {
			expect(violets).not.toContain(resolveToken(tokens, token))
		}
	})
})
