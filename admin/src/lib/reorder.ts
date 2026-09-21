/**
 * Moving a description item without typing a number at it.
 *
 * The form underneath carries a `position` box per row and sorts by whatever
 * numbers arrive. That works with this file deleted or unexecuted, which is the
 * point — but a position is how the form talks to itself, and somebody editing
 * prose should not have to see it. So when this runs it hides the boxes, adds a
 * arrows — which the page renders and hides — and keeps the numbers correct
 * behind them.
 *
 * The arrows are in the markup rather than built here on purpose: a button
 * created in script carries none of Astro's scoping attributes and comes out
 * unstyled. So the page renders them `display: none` and this file's only
 * visible effect is the class that reveals them.
 *
 * The second enhancement in this admin, after `run-now.ts`, and the same shape:
 * the page is complete before it runs and better after.
 *
 * ## Nothing reaches the server until Save
 *
 * Moving a row reorders the DOM and renumbers the hidden inputs. There is no
 * request, no round trip and nothing to lose if the tab closes — the form is in
 * exactly the state a typed position would have left it in, and the save that
 * follows is the same save.
 *
 * ## Why buttons rather than dragging
 *
 * Dragging is nicer with a mouse and unusable without one. Arrows are reachable
 * by keyboard and readable by a screen reader for free, which a drag handle only
 * becomes with the keyboard affordance written back in — at which point the
 * arrows exist anyway. Dragging can be added on top of this later; the ordering
 * it would produce is the same renumbering.
 */

/**
 * What the page marks so its CSS can swap the explanation and hide the position
 * boxes.
 *
 * Put on the surrounding section rather than the list, because the sentence
 * telling somebody how to reorder is not inside the list — and a class that
 * reaches only half of what it describes is how a page ends up telling you to
 * type a number at a box it has just hidden.
 */
const ENHANCED = 'reorder-enhanced'

const rowsOf = (list: Element): HTMLElement[] =>
    [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement)

/**
 * Renumbers every position box from the top, 1, 2, 3…
 *
 * Sequential rather than preserving whatever was there: the DOM is the order
 * once this file is running, and the numbers exist only to carry that order
 * through the submit. The server sorts by them and breaks ties by the order
 * they arrive in, so these agree with it twice over.
 */
function renumber(list: Element): void {
    rowsOf(list).forEach((row, index) => {
        const position = row.querySelector<HTMLInputElement>('input[name$="-position"]')
        if (position) position.value = String(index + 1)
    })
}

/**
 * Enables or disables each row's arrows so the ends cannot be walked past.
 *
 * Disabled rather than hidden: a control that vanishes moves everything below
 * it, which is the last thing a reordering UI should do to somebody who is
 * aiming at one.
 */
function refreshArrows(list: Element): void {
    const rows = rowsOf(list)
    rows.forEach((row, index) => {
        const up = row.querySelector<HTMLButtonElement>('[data-move="up"]')
        const down = row.querySelector<HTMLButtonElement>('[data-move="down"]')
        if (up) up.disabled = index === 0
        if (down) down.disabled = index === rows.length - 1
    })
}

function move(list: Element, row: HTMLElement, direction: 'up' | 'down'): void {
    const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling
    if (!sibling) return

    if (direction === 'up') list.insertBefore(row, sibling)
    else list.insertBefore(sibling, row)

    renumber(list)
    refreshArrows(list)

    // The row has moved out from under the pointer, so the button that was just
    // pressed is somewhere else on screen. Following it with focus is what makes
    // a second press land on the same row — and is the whole of the keyboard
    // story for this control.
    row.querySelector<HTMLButtonElement>(`[data-move="${direction}"]:not([disabled])`)?.focus()
}

/**
 * Adds the arrows and takes over the ordering.
 *
 * Idempotent, and it refuses politely when there is nothing to enhance: a page
 * without a description list is every other page in the admin.
 */
export function enhance(root: ParentNode = document): void {
    const list = root.querySelector('[data-reorder]')
    if (!list || (list.closest('section') ?? list).classList.contains(ENHANCED)) return

    // Disabled rows are the read-only rendering, before the ownership flip.
    // Enhancing them would offer a control that cannot do anything.
    if (list.querySelector('input[name$="-position"]:disabled')) return

    list.addEventListener('click', (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-move]')
        const row = button?.closest<HTMLElement>('[data-row]')
        if (!button || !row || button.disabled) return
        move(list, row, button.dataset.move === 'up' ? 'up' : 'down')
    })

    ;(list.closest('section') ?? list).classList.add(ENHANCED)
    renumber(list)
    refreshArrows(list)
}
