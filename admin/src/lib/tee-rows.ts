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

function add(body: Element, template: HTMLTableRowElement, blankColumn: number): void {
    const row = template.cloneNode(true) as HTMLTableRowElement
    row.classList.remove(BLANK)
    const index = nextIndex(body, PREFIX)
    reindex(row, PREFIX, index)

    // Before the blank row rather than after it, so the row somebody just asked
    // for is where they are looking and the hidden one stays last.
    body.insertBefore(row, rowsIn(body).find((candidate) => candidate.classList.contains(BLANK)) ?? null)
    addLengthColumn(row.ownerDocument, blankColumn, index)
    row.querySelector<HTMLInputElement>(`[name$="-name"]`)?.focus()
}

/**
 * Gives a newly added tee a column in the scorecard, so it can be measured in
 * the same save it is created in.
 *
 * Without this, adding a tee with the script running is the one way of adding
 * one that cannot record a length: the page renders a column per tee row it
 * knew about, and the empty row those would have used is hidden the moment this
 * enhancement takes over. The no-script path has never had the problem — you
 * type in the empty row and its column is right there.
 *
 * The cell is cloned from that same hidden column rather than built, for the
 * reason everything here is cloned: an element made in script carries none of
 * Astro's scoping attributes. Only the tee half of the name is rewritten —
 * `hole-3-len-2` keeps its hole and changes its tee — which is why this does
 * not use the shared `reindex`.
 */
function addLengthColumn(document: Document, from: number, to: number): void {
    const holes = document.querySelector('[data-holes]')
    if (!holes) return

    for (const row of holes.querySelectorAll('tr')) {
        const source = row.querySelector<HTMLInputElement>(`[name$="-len-${from}"]`)?.closest('td')
        if (!source) continue

        const cell = source.cloneNode(true) as HTMLTableCellElement
        for (const field of cell.querySelectorAll<HTMLInputElement>('[name]')) {
            field.setAttribute('name', field.getAttribute('name')!.replace(/-len-\d+$/, `-len-${to}`))
            field.value = ''
        }
        row.append(cell)
    }

    // And a heading for it, cloned from the one the hidden column had.
    const headings = holes.closest('table')?.querySelectorAll('thead th')
    const lastHeading = headings?.[headings.length - 1]
    if (lastHeading) lastHeading.parentElement?.append(lastHeading.cloneNode(true))
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

    // The column the hidden empty row would have used, which is the one a new
    // tee's column is copied from.
    const blankColumn = rowsIn(body).findIndex((row) => row.classList.contains(BLANK))

    section.addEventListener('click', (event) => {
        const target = event.target as Element | null
        if (target?.closest('[data-add-tee]')) return add(body, blank, blankColumn)

        const row = target?.closest<HTMLTableRowElement>('tr[data-tee]')
        if (!row) return
        if (target?.closest('[data-remove]')) return remove(row)
        if (target?.closest('[data-undo]')) return undo(row)
    })

    section.classList.add(ENHANCED)
}
