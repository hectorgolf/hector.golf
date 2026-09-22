import { contrast, parseHex } from './colour.ts'

/**
 * The ring around a tee's dot, worked out rather than stored.
 *
 * A tee is drawn as a small filled circle. Two things have to be true of it:
 * it has to be visible against the page, and it has to be the same size as
 * every other one — a dot that drops its ring is visibly smaller than a dot
 * beside it that keeps one, which reads as a difference in the data rather
 * than in the drawing.
 *
 * So every dot gets a ring of the same width, always, and the only question is
 * what colour. There are two useful answers:
 *
 * - **white**, when the fill does not separate from the page on its own. A
 *   black tee on a near-black page is otherwise a hole rather than a dot.
 * - **the fill itself**, when it does. The ring is still there and still a
 *   pixel wide; it simply does not announce itself.
 *
 * Never black, which is what the stored values used to be: `#000000` against
 * this page is a contrast of 1.13 to 1, so eighteen of the twenty tees that
 * carried an outline had one nobody could see. They read like they were chosen
 * for white paper.
 *
 * ## Why this is computed and not a field
 *
 * It was a field — `stroke` on each tee — and being a field is what let it be
 * wrong on eighteen of the twenty tees that set it, for as long as it existed:
 * nothing about the editor showed what the choice did, so nothing showed that
 * it did nothing. A rule cannot drift from the page, because it reads the
 * page's colour.
 */

/**
 * Where the dots are drawn. The scorecard and rating tables sit on `--surface`
 * rather than on the page itself, and it is the nearer of the two.
 *
 * A literal rather than a `var()` because this is arithmetic, not styling: the
 * answer has to be a colour by the time it reaches the `stroke` attribute. It
 * is checked against the stylesheet by `tee-dots.test.ts`, so the two cannot
 * drift apart silently.
 *
 * The same colour in both apps, because both import `hector.css` — the admin's
 * scorecard sits on the same `--surface` the site's does.
 */
export const DOT_GROUND = '#131215'

/** What every dot's ring is, in the units the SVG uses. */
export const DOT_STROKE_WIDTH = 1

/**
 * Sufficient contrast for omitting a border ring against the ground color.
 * WCAG's floor for a graphical object against its background is actually a bit
 * higher (~3) but for our purposes this is good enough.
 *
 * It lands in real space here rather than on a boundary: across the committed
 * courses the fills sort into a group at 2.17 and below — black, and the two
 * blues — and a group from 3.62 up. Nothing sits near the line, so a tee does
 * not change appearance because somebody nudged a hex by a digit.
 */
const ENOUGH = 2.5

/** White, and the only ring colour that is not simply the fill. */
export const RING = '#ffffff'

/**
 * The ring colour for a fill, against the ground the dot is drawn on.
 *
 * A fill this cannot parse gets the ring, on the grounds that something
 * unreadable is more likely to be invisible than not — `color` is a free
 * string on the schema, so `red` and `rebeccapurple` are both allowed and
 * neither is a hex.
 */
export function ringFor(fill: string, ground: string = DOT_GROUND): string {
    let separated: boolean
    try {
        separated = contrast(parseHex(fill), parseHex(ground)) >= ENOUGH
    } catch {
        return RING
    }
    return separated ? fill : RING
}
