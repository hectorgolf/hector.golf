/**
 * Renders the favicons of both properties from one mark and one palette.
 *
 * hector.golf takes gold and admin.hector.golf takes fairway green. The two are
 * usually open side by side, and the tab strip is the only place a reader is asked
 * to tell them apart, so the tab strip is where they are given different colours.
 *
 *     npm run icons
 *
 * The outputs are committed and nothing in either build runs this — it is here so
 * that the next recolour is an edit to a token rather than a trip through a drawing
 * program. Rasterising needs rsvg-convert (`brew install librsvg`); the SVG sources
 * are written whether or not it is installed.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	HECTOR_MARK_BOUNDS,
	HECTOR_MARK_BOX,
	HECTOR_MARK_ORIGIN,
	HECTOR_MARK_PATH,
} from '../packages/ui/components/hector-mark-path.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

const stylesheet = readFileSync(join(repo, 'packages/ui/styles/hector.css'), 'utf8')

/**
 * Read a tint out of the stylesheet rather than repeating its hex here, for the
 * same reason /brand reads its swatches from there: a colour written down twice is
 * a colour that eventually disagrees with itself. Only flat values are wanted, so
 * this deliberately does not follow `var()` chains.
 */
function tint(token: string): string {
	const value = stylesheet.match(new RegExp(`${token}:\\s*(#[0-9a-f]{3,8})\\s*;`, 'i'))?.[1]
	if (!value) throw new Error(`No flat colour for ${token} in hector.css`)
	return value
}

const ground = tint('--ink-950')

/**
 * The mark on the page ground, scaled about the centre of the box so it keeps the
 * slightly-left seating it has in the header. A tile rather than a bare mark: gold
 * on white is too faint to survive a 16px tab, and the design system is dark-ground
 * only, so the icon brings its own ground with it.
 *
 * `radius` is 0 for the Apple touch icon, which iOS masks to its own shape — a tile
 * already rounded would be rounded twice.
 */
function favicon(colour: string, radius = 0.21 * HECTOR_MARK_BOX): string {
	const box = HECTOR_MARK_BOX
	const inset = 0.92
	const centre = {
		x: HECTOR_MARK_ORIGIN.x + HECTOR_MARK_BOUNDS.width / 2,
		y: HECTOR_MARK_ORIGIN.y + HECTOR_MARK_BOUNDS.height / 2,
	}
	const tidy = (n: number) => Number(n.toFixed(3))
	const seat = `translate(${box / 2} ${box / 2}) scale(${inset}) translate(${tidy(-centre.x)} ${tidy(-centre.y)})`

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" role="img" aria-label="Hector">
	<rect width="${box}" height="${box}" rx="${radius}" fill="${ground}" />
	<g transform="${seat}">
		<path fill-rule="evenodd" fill="${colour}" d="${HECTOR_MARK_PATH}" />
	</g>
</svg>
`
}

function png(svg: string, size: number): Buffer {
	try {
		return execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size)], {
			input: svg,
			maxBuffer: 1 << 24,
		})
	} catch (error) {
		const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : String(error)
		throw new Error(`rsvg-convert ${reason}. Install it with \`brew install librsvg\`.`)
	}
}

/**
 * An .ico is a directory of images; since Vista each may be a PNG rather than a
 * bitmap, which is what every browser that still wants an .ico reads. Two sizes,
 * because 16px is what a tab actually shows and letting the browser shrink the 32
 * turns line art into a smudge.
 */
function ico(images: Buffer[]): Buffer {
	const header = Buffer.alloc(6)
	header.writeUInt16LE(0, 0) // reserved
	header.writeUInt16LE(1, 2) // 1 = icon
	header.writeUInt16LE(images.length, 4)

	let offset = header.length + images.length * 16
	const entries = images.map((image) => {
		const size = image.readUInt32BE(16) // the PNG header's width
		const entry = Buffer.alloc(16)
		entry.writeUInt8(size < 256 ? size : 0, 0)
		entry.writeUInt8(size < 256 ? size : 0, 1)
		entry.writeUInt16LE(1, 4) // colour planes
		entry.writeUInt16LE(32, 6) // bits per pixel
		entry.writeUInt32LE(image.length, 8)
		entry.writeUInt32LE(offset, 12)
		offset += image.length
		return entry
	})

	return Buffer.concat([header, ...entries, ...images])
}

function write(path: string, contents: string | Buffer): void {
	const full = join(repo, path)
	mkdirSync(dirname(full), { recursive: true })
	writeFileSync(full, contents)
	console.log(`  ${path}`)
}

/*
 * The site is Hector, so its icon is the house gold — the same token the header
 * wordmark reads. The admin takes the fairway hue directly rather than through
 * --victor: the token names a competition, and nothing in the admin is one.
 */
const properties = [
	{
		name: 'hector.golf',
		dir: 'astrosite/public/icons',
		colour: tint('--gold-400'),
		/* The site is installable, so it needs the home-screen sizes too. */
		touch: true,
	},
	{
		name: 'admin.hector.golf',
		dir: 'admin/public/icons',
		colour: tint('--fairway-400'),
		/* Behind IAP, noindex, and nobody installs it. A tab icon is the whole job. */
		touch: false,
	},
]

for (const property of properties) {
	console.log(property.name)
	const tile = favicon(property.colour)

	write(`${property.dir}/favicon.svg`, tile)
	write(`${property.dir}/icon-32.ico`, ico([png(tile, 16), png(tile, 32)]))

	if (!property.touch) continue
	write(`${property.dir}/icon-180.png`, png(favicon(property.colour, 0), 180))
	write(`${property.dir}/icon-192.png`, png(tile, 192))
	write(`${property.dir}/icon-512.png`, png(tile, 512))
}
