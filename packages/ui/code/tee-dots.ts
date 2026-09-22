import {
    contrast,
    decreaseLuminance,
    increaseLuminance,
    moveTowardWhite,
    parseHex,
    toHex,
    type Rgb,
} from "./colour.ts";

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
 * - **the fill itself**, when it separates from the page.
 * - **a brighter or darker version of the fill**, when that preserves its hue
 *   and reaches the contrast floor.
 * - **the nearer extreme**, white or black, when neither direction works.
 *
 * The final extreme is allowed to be black: it is preferable to an invisible
 * border when the fill is visually closer to black and neither hue-preserving
 * direction can reach the contrast floor.
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
export const DOT_GROUND = "#131215";

/** What every dot's ring is, in the units the SVG uses. */
export const DOT_STROKE_WIDTH = 1;

/**
 * WCAG's floor for a graphical object against its background.
 *
 * It lands in real space here rather than on a boundary: across the committed
 * courses the fills sort into a group at 2.17 and below — black, and the two
 * blues — and a group from 3.62 up. Nothing sits near the line, so a tee does
 * not change appearance because somebody nudged a hex by a digit.
 */
const ENOUGH = 3;

/** White, and the only ring colour that is not simply the fill. */
const WHITE = "#ffffff";

const BLACK = "#000000";
const STEP = 0.075;

function rgbDistance(a: Rgb, b: Rgb): number {
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The ring colour for a fill, against the ground the dot is drawn on.
 *
 * A fill this cannot parse gets the ring, on the grounds that something
 * unreadable is more likely to be invisible than not — `color` is a free
 * string on the schema, so `red` and `rebeccapurple` are both allowed and
 * neither is a hex.
 */
export function ringFor(fill: string, ground: string = DOT_GROUND): string {
    let separated: boolean;
    const bg = parseHex(ground);
    try {
        separated = contrast(parseHex(fill), bg) >= ENOUGH;
        if (separated) {
            return fill;
        }

        const original = parseHex(fill);
        let lighter = original;
        for (let i = 0; i < 100; i++) {
            const next = increaseLuminance(lighter, STEP);
            if (toHex(next) === toHex(lighter)) break;
            if (contrast(next, bg) >= ENOUGH) return toHex(next);
            lighter = next;
        }

        let darker = original;
        for (let i = 0; i < 100; i++) {
            const next = decreaseLuminance(darker, STEP);
            if (toHex(next) === toHex(darker)) break;
            if (contrast(next, bg) >= ENOUGH) return toHex(next);
            darker = next;
        }

        let lessChromatic = original;
        for (let i = 0; i < 100; i++) {
            const next = moveTowardWhite(lessChromatic, STEP);
            if (toHex(next) === toHex(lessChromatic) || toHex(next) === WHITE) break;
            if (contrast(next, bg) >= ENOUGH) return toHex(next);
            lessChromatic = next;
        }

        const black = parseHex(BLACK);
        const white = parseHex(WHITE);
        const blackContrast = contrast(black, bg);
        const whiteContrast = contrast(white, bg);
        if (blackContrast >= ENOUGH && whiteContrast < ENOUGH) return BLACK;
        if (whiteContrast >= ENOUGH && blackContrast < ENOUGH) return WHITE;
        return rgbDistance(original, black) <= rgbDistance(original, white) ? BLACK : WHITE;
    } catch {
        return WHITE;
    }
}
