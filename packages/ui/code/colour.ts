/**
 * Colour arithmetic, shared by the site and the admin.
 *
 * Here rather than in either app because both draw the same tee dots against
 * the same tokens — `hector.css` is imported by both — and a second copy of a
 * contrast calculation is a second answer to "is this visible", which is the
 * sort of thing that goes wrong in only one of two places.
 *
 * WCAG's definitions, unchanged: a hex is parsed the way CSS parses one, and
 * the ratio is the one the guidelines specify for deciding whether something
 * can be seen against what is behind it.
 */

export type Rgb = { r: number; g: number; b: number }

/** `#abc` and `#aabbcc`, the two spellings CSS allows for an opaque hex. */
export function parseHex(hex: string): Rgb {
    const digits = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
    if (!digits) throw new Error(`Not a hex colour: ${hex}`)
    const full =
        digits.length === 3
            ? digits
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : digits
    return {
        r: Number.parseInt(full.slice(0, 2), 16),
        g: Number.parseInt(full.slice(2, 4), 16),
        b: Number.parseInt(full.slice(4, 6), 16),
    }
}

const linearize = (value: number): number => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** WCAG contrast ratio, always >= 1 whichever way round the pair is given. */
export function contrast(a: Rgb, b: Rgb): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (lighter! + 0.05) / (darker! + 0.05)
}
