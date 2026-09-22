/**
 * The colour picker beside each tee's hex box, kept in step with it.
 *
 * Choosing a colour by typing `#d4af37`, saving, and looking at the result to
 * find out whether it was the gold you meant is a slow way to choose a colour.
 * So each hex box has a native picker next to it — a swatch showing the current
 * colour, which opens the platform's colour wheel — and the two follow each
 * other.
 *
 * ## The hex box is still the field
 *
 * The swatch has no `name` and submits nothing, which is deliberate:
 * `input[type="color"]` holds nothing but a plain `#rrggbb`, and `color` is a
 * free string on the schema — a course carrying `red` would be rewritten by a
 * control nobody touched. A hex is also worth reading down the column and
 * pasting between rows.
 *
 * So the text is the value and the swatch is a way of editing it, which is why
 * the swatch stays hidden until this file runs: a picker that does not write to
 * the box beside it is a control that looks like it works.
 */

/** What the page marks so its CSS reveals the swatches. */
const ENHANCED = 'tee-colours-enhanced'

/** What a colour input can represent, and nothing else. */
const HEX = /^#[0-9a-f]{6}$/i

/**
 * Shows the row's colour in its swatch.
 *
 * Left alone when the box holds something a colour input cannot represent, so
 * the swatch never offers to replace a value it cannot show — and `#000000`,
 * which is what an unset colour input reads as, is never written back to a
 * course on that account.
 */
function sync(row: Element): void {
    const swatch = row.querySelector<HTMLInputElement>('.swatch')
    const field = row.querySelector<HTMLInputElement>('[name$="-color"]')
    if (!swatch || !field) return

    const value = field.value.trim()
    if (HEX.test(value)) swatch.value = value
}

/**
 * Reveals the swatches and keeps them in step.
 *
 * Delegated from the section rather than bound per row, so a tee added by
 * `tee-rows.ts` after this ran is covered without the two files knowing about
 * each other: the clone carries its own swatch, and the listener here finds it
 * the first time it is touched. The clone is synced on the way in for the same
 * reason the rendered rows are — an unsynced colour input reads black, which is
 * a colour, which makes a broken control look like a deliberate one.
 */
export function enhance(root: ParentNode = document): void {
    const body = root.querySelector('[data-tees]')
    const section = body?.closest('section') ?? body
    if (!body || !section || section.classList.contains(ENHANCED)) return

    // Disabled rows are the read-only rendering, before the ownership flip.
    if (body.querySelector('input[name$="-color"]:disabled')) return

    for (const row of body.querySelectorAll('tr[data-tee]')) sync(row)

    // `input` rather than `change`: a native picker fires it while somebody is
    // still dragging, so the hex updates as the colour does rather than once
    // the dialog closes.
    section.addEventListener('input', (event) => {
        const target = event.target as HTMLInputElement | null
        const row = target?.closest('tr[data-tee]')
        if (!target || !row) return

        if (target.classList.contains('swatch')) {
            const field = row.querySelector<HTMLInputElement>('[name$="-color"]')
            if (!field || field.disabled) return
            field.value = target.value
            // So that anything else listening to this form sees the same event
            // a person typing would have made.
            field.dispatchEvent(new Event('input', { bubbles: true }))
            return
        }

        if (target.name.endsWith('-color')) sync(row)
    })

    /*
     * A tee added after this ran gets its swatch filled in too. `tee-rows.ts`
     * clones a row it never saw the inside of, so the clone's swatch carries
     * whatever the template's did — and the template is the empty row, whose
     * colour is white.
     */
    section.addEventListener('click', (event) => {
        if (!(event.target as Element | null)?.closest('[data-add-tee]')) return
        queueMicrotask(() => {
            for (const row of body.querySelectorAll('tr[data-tee]')) sync(row)
        })
    })

    section.classList.add(ENHANCED)
}
