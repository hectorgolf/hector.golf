/**
 * Adding and removing tees, in the browser.
 *
 * The third enhancement in this admin and the same shape as the other two: the
 * page is complete before it runs and better after. Without it, the empty row
 * at the end of the table still adds a tee and a tee cannot be removed at all,
 * which is where this table has been since the editor was written.
 *
 * ## Removing a tee is not like removing a paragraph
 *
 * The per-hole lengths on the scorecard are keyed by tee name. Dropping a tee
 * drops its column — `applyTeeEdits` does that deliberately and there is a test
 * for it — so this is the one control in the editor that destroys measurements
 * nobody can retype from memory.
 *
 * Two things follow. The row stays visible rather than collapsing to a line, so
 * what is about to be lost is on screen and named while the decision is still
 * reversible. And nothing happens until Save, as everywhere else here: Undo is
 * a button, not a recovery.
 *
 * The plan for this editor said a tee could not be removed, because a form
 * where clearing a name deletes measurements deletes them by accident. That
 * argument was about clearing a name, and it still holds — clearing a name
 * still does nothing but leave a nameless row. This is the considered way to
 * ask that the same note said to build when somebody needed it.
 */

import { disableRow, enableRow, nextIndex, reindex } from './form-rows.ts'

const PREFIX = 'tee'

/** What the page marks so its CSS can reveal the buttons and hide the empty row. */
const ENHANCED = 'tees-enhanced'

/** The empty row the server always renders: the no-script way to add a tee, and the template. */
const BLANK = 'blank'

/** A row somebody has pressed Remove on. Its fields are disabled, so it submits nothing. */
const REMOVED = 'removed'

const rowsIn = (body: Element): HTMLTableRowElement[] =>
    [...body.querySelectorAll<HTMLTableRowElement>('tr[data-tee]')]

function add(body: Element, template: HTMLTableRowElement): void {
    const row = template.cloneNode(true) as HTMLTableRowElement
    row.classList.remove(BLANK)
    reindex(row, PREFIX, nextIndex(body, PREFIX))

    // Before the blank row rather than after it, so the row somebody just asked
    // for is where they are looking and the hidden one stays last.
    body.insertBefore(row, rowsIn(body).find((candidate) => candidate.classList.contains(BLANK)) ?? null)
    row.querySelector<HTMLInputElement>(`[name$="-name"]`)?.focus()
}

function remove(row: HTMLTableRowElement): void {
    row.classList.add(REMOVED)
    disableRow(row, PREFIX)
    row.querySelector<HTMLButtonElement>('[data-undo]')?.focus()
}

function undo(row: HTMLTableRowElement): void {
    row.classList.remove(REMOVED)
    enableRow(row, PREFIX)
    row.querySelector<HTMLButtonElement>('[data-remove]')?.focus()
}

/**
 * Takes the table over.
 *
 * Idempotent, and it declines when there is nothing to do: a page whose fields
 * are disabled is the read-only rendering from before the ownership flip, and
 * enhancing it would offer controls that cannot act.
 */
export function enhance(root: ParentNode = document): void {
    const body = root.querySelector('[data-tees]')
    const section = body?.closest('section') ?? body
    if (!body || !section || section.classList.contains(ENHANCED)) return
    if (body.querySelector('input[name$="-name"]:disabled')) return

    const template = rowsIn(body).find((row) => row.classList.contains(BLANK))
    if (!template) return
    const blank = template.cloneNode(true) as HTMLTableRowElement

    section.addEventListener('click', (event) => {
        const target = event.target as Element | null
        if (target?.closest('[data-add-tee]')) return add(body, blank)

        const row = target?.closest<HTMLTableRowElement>('tr[data-tee]')
        if (!row) return
        if (target?.closest('[data-remove]')) return remove(row)
        if (target?.closest('[data-undo]')) return undo(row)
    })

    section.classList.add(ENHANCED)
}
