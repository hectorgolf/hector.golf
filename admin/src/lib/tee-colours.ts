/**
 * A colour swatch beside each tee's hex box, kept in step with it.
 *
 * Picking a colour by typing `#d4af37` and saving to find out whether it was
 * the gold you meant is a slow way to choose a colour. So each hex box gets a
 * native picker next to it, and the two follow each other.
 *
 * ## The hex box is still the field
 *
 * The swatch has no `name` and submits nothing. That is deliberate rather than
 * incidental:
 *
 * - `input[type="color"]` cannot hold **nothing**, and an outline that is not
 *   set is how a tee says "draw the dot without one". A swatch that submitted
 *   would turn every blank outline into `#000000` the moment the page loaded.
 * - it cannot hold anything that is not a plain `#rrggbb` either, and `color`
 *   is a free string on the schema. A course carrying `red` or a colour with
 *   transparency would have it rewritten by a control nobody touched.
 * - a hex is worth reading and comparing down the column, and worth pasting
 *   between rows.
 *
 * So the text is the value and the swatch is a way of editing it, which is also
 * why the swatch is hidden until this file runs: a picker that does not write
 * to the box beside it is a control that looks like it works.
 */

/** What the page marks so its CSS reveals the swatches. */
const ENHANCED = 'tee-colours-enhanced'

/** What a colour input can represent, and nothing else. */
const HEX = /^#[0-9a-f]{6}$/i

/**
 * The colour a swatch should show for a box, or `undefined` to leave it be.
 *
 * An empty outline box shows the fill colour from the same row rather than
 * black, because that is what the site draws when there is no outline — so the
 * swatch opens on the colour actually in use rather than on a colour that would
 * be a change.
 */
function shownFor(field: HTMLInputElement, row: Element): string | undefined {
    const own = field.value.trim()
    if (HEX.test(own)) return own
    if (own !== '') return undefined

    const fill = row.querySelector<HTMLInputElement>('[name$="-color"]')?.value.trim() ?? ''
    return field.name.endsWith('-stroke') && HEX.test(fill) ? fill : undefined
}

function sync(row: Element): void {
    for (const swatch of row.querySelectorAll<HTMLInputElement>('.swatch')) {
        const field = row.querySelector<HTMLInputElement>(`[name$="-${swatch.dataset.picks}"]`)
        if (!field) continue
        const shown = shownFor(field, row)
        if (shown) swatch.value = shown
    }
}

/**
 * Reveals the swatches and keeps them in step.
 *
 * Delegated from the section rather than bound per row, so a tee added by
 * `tee-rows.ts` after this ran is covered without the two files knowing about
 * each other — the clone carries its own swatch, and the listener here finds it
 * the first time it is touched.
 */
export function enhance(root: ParentNode = document): void {
    const body = root.querySelector('[data-tees]')
    const section = body?.closest('section') ?? body
    if (!body || !section || section.classList.contains(ENHANCED)) return
    if (body.querySelector('input[name$="-color"]:disabled')) return

    for (const row of body.querySelectorAll('tr[data-tee]')) sync(row)

    // `input` rather than `change`: a native picker fires it while somebody is
    // still dragging, so the hex updates as the colour does rather than after
    // the dialog closes.
    section.addEventListener('input', (event) => {
        const target = event.target as HTMLInputElement | null
        const row = target?.closest('tr[data-tee]')
        if (!target || !row) return

        if (target.classList.contains('swatch')) {
            const field = row.querySelector<HTMLInputElement>('[name$="-color"]')
            if (!field || field.disabled) return
            field.value = target.value
            // For anything else listening to the form, and so that a framework
            // or a later enhancement sees the same event a person typing makes.
            field.dispatchEvent(new Event('input', { bubbles: true }))
            return
        }

        if (target.name.endsWith('-color') || target.name.endsWith('-stroke')) sync(row)
    })

    section.classList.add(ENHANCED)
}
