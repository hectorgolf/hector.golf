/**
 * Reads the design system's colour tokens straight out of the stylesheet.
 *
 * The point is that /brand cannot drift from `src/styles/hector.css`: every swatch,
 * hex code, hue angle and contrast ratio on that page is derived from the same
 * declarations the site itself renders from, at build time. Edit the stylesheet and
 * the brandbook follows on the next build.
 */

import { contrast, luminance, parseHex, type Rgb } from '@hector/ui/code/colour.ts'

export { contrast, luminance, parseHex, type Rgb }

export type Palette = Record<string, string>

export type Swatch = {
	/** Token name including the leading dashes, e.g. `--hector`. */
	token: string
	/** What the token resolves to after following any `var()` references. */
	value: string
	hex: string
	rgb: Rgb
	/** Degrees on the colour wheel, or undefined for a neutral. */
	hue: number | undefined
	/** WCAG contrast against the page ground, to one decimal place. */
	contrast: number
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Pull the custom properties out of the stylesheet's `:root` block. Comments go
 * first — they contain colons and semicolons that would otherwise parse as
 * declarations.
 */
export function parseRootTokens(css: string): Palette {
	const block = stripComments(css).match(/:root\s*\{([^}]*)\}/)?.[1]
	if (!block) throw new Error('No :root block found in the stylesheet')

	const tokens: Palette = {}
	for (const declaration of block.split(';')) {
		const separator = declaration.indexOf(':')
		if (separator === -1) continue
		const name = declaration.slice(0, separator).trim()
		if (!name.startsWith('--')) continue
		tokens[name] = declaration.slice(separator + 1).trim()
	}
	return tokens
}

/** Follow `var(--x)` references until an actual value falls out. */
export function resolveToken(tokens: Palette, name: string, seen: string[] = []): string {
	const raw = tokens[name]
	if (raw === undefined) throw new Error(`Unknown token: ${name}`)
	if (seen.includes(name)) throw new Error(`Cyclic token reference: ${[...seen, name].join(' -> ')}`)

	const reference = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/)
	return reference ? resolveToken(tokens, reference[1], [...seen, name]) : raw
}





/**
 * The most chroma any step of the ink scale carries — ink-500 (#9a98a6), at 14.
 *
 * Ink is deliberately biased a little toward violet rather than being a flat grey,
 * so "achromatic" has to be a tolerance rather than an exact match: below this the
 * colour is a neutral playing a neutral's role, and reporting a hue angle for it
 * would be noise. The palette's dimmest actual colour, violet-950, sits at 30, so
 * there is comfortable room between the two.
 */
const NEUTRAL_CHROMA_LIMIT = 15

/** Hue in degrees, or undefined when the colour has no hue worth reporting. */
export function hue({ r, g, b }: Rgb): number | undefined {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const chroma = max - min
	if (chroma < NEUTRAL_CHROMA_LIMIT) return undefined

	let sextant: number
	if (max === r) sextant = ((g - b) / chroma) % 6
	else if (max === g) sextant = (b - r) / chroma + 2
	else sextant = (r - g) / chroma + 4

	const degrees = sextant * 60
	return degrees < 0 ? degrees + 360 : degrees
}

export const toHex = ({ r, g, b }: Rgb): string =>
	'#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')

/**
 * Everything the brandbook needs about one token, measured against the page ground.
 */
export function describeToken(tokens: Palette, token: string, groundToken = '--bg'): Swatch {
	const value = resolveToken(tokens, token)
	const rgb = parseHex(value)
	const ground = parseHex(resolveToken(tokens, groundToken))
	return {
		token,
		value,
		hex: toHex(rgb),
		rgb,
		hue: hue(rgb),
		contrast: Math.round(contrast(rgb, ground) * 10) / 10,
	}
}
