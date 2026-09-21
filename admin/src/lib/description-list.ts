/**
 * Building a course's description without typing numbers at it: adding rows,
 * and moving them.
 *
 * The form underneath carries a `position` box per row, sorts by whatever
 * numbers arrive, and renders one blank row of each kind at the end so that an
 * item can be added with this file deleted or unexecuted. That is the point —
 * but a position is how the form talks to itself, "one new item per save" is a
 * strange thing to ask of somebody writing three paragraphs, and neither is
 * anything a person editing prose should have to know about. So when this runs
 * it hides the position boxes and the blank rows, reveals arrows, a Remove
 * button and two add buttons the page has already rendered, and keeps the
 * numbering correct behind them.
 *
 * Removing without the script is a checkbox you tick and then press Save, which
 * is the least a form can do and reads like a form doing the least: the row you
 * asked to be rid of sits there looking exactly as it did. With the script the
 * row goes when you say so, and an "Undo" takes its place until you save.
 *
 * The controls are in the markup rather than built here on purpose: an element
 * created in script carries none of Astro's scoping attributes and comes out
 * unstyled. So the page renders them `display: none` and this file's visible
 * effect is the class that reveals them — and a new row is a *clone* of a row
 * the server rendered, for the same reason.
 *
 * The second enhancement in this admin, after `run-now.ts`, and the same shape:
 * the page is complete before it runs and better after.
 *
 * ## Nothing reaches the server until Save
 *
 * Adding a row or moving one changes the DOM and renumbers the hidden inputs.
 * There is no request, no round trip and nothing to lose if the tab closes —
 * the form is in exactly the state typed positions would have left it in, and
 * the save that follows is the same save. The server reads whatever `item-N-`
 * rows arrive rather than the number it last rendered, which is what lets there
 * be more of them than it knows about.
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
 * What the page marks so its CSS can swap the explanation, hide the position
 * boxes and the blank rows, and show the arrows and the add buttons.
 *
 * Put on the surrounding section rather than the list, because the sentence
 * telling somebody how to reorder and the buttons that add a row are both
 * outside the list — and a class that reaches only part of what it describes is
 * how a page ends up telling you to type a number at a box it has just hidden.
 */
const ENHANCED = 'list-enhanced'

/**
 * A row the server rendered empty, which the page hides once this runs.
 *
 * Two jobs: it is the no-script way to add an item, and it is the template a
 * new row is cloned from. It stays in the form and submits empty, which the
 * server drops.
 */
const BLANK = 'blank'

/**
 * A row somebody has pressed Remove on.
 *
 * The row is still in the form and its fields still hold what they held. What
 * changes is that every one of them is disabled, and a disabled field is not
 * submitted — so the row arrives as no `item-N-` keys at all, and the server
 * reads it as a row that is not there. That is only true because the server
 * reads whichever indices turn up rather than counting rows; before that it
 * would have read the row after it as this one.
 *
 * Disabled rather than detached, so Undo is putting the fields back rather than
 * rebuilding them, and the text somebody wrote survives a mistaken click.
 */
const REMOVED = 'removed'

/** Marks a field this file disabled, so Undo re-enables only those. */
const MINE = 'wasEnabled'

const isBlank = (row: Element): boolean => row.classList.contains(BLANK)
const isRemoved = (row: Element): boolean => row.classList.contains(REMOVED)

/** The rows somebody can see and act on. Blank ones are hidden; removed ones are gone. */
const rowsOf = (list: Element): HTMLElement[] =>
    [...list.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement && !isBlank(child) && !isRemoved(child)
    )

/** The rest, in DOM order: numbered after the visible ones so nothing collides. */
const asideOf = (list: Element): HTMLElement[] =>
    [...list.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement && (isBlank(child) || isRemoved(child))
    )

const blanksOf = (list: Element): HTMLElement[] =>
    [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && isBlank(child))

const fieldsOf = (row: ParentNode): HTMLElement[] => [...row.querySelectorAll<HTMLElement>('[name^="item-"]')]

/** What kind of row this is, as the hidden field the server reads says. */
const kindOf = (row: ParentNode): string =>
    row.querySelector<HTMLInputElement>('input[name$="-kind"]')?.value ?? 'paragraph'

/**
 * Renumbers every position box from the top, 1, 2, 3…
 *
 * Sequential rather than preserving whatever was there: the DOM is the order
 * once this file is running, and the numbers exist only to carry that order
 * through the submit. The server sorts by them and breaks ties by the order
 * they arrive in, so these agree with it twice over.
 *
 * The hidden blank rows are numbered last rather than left alone, so that a
 * number they still carry from the server cannot land in the middle of the real
 * ones. They are dropped either way — this is just so the form never says
 * something it does not mean.
 */
function renumber(list: Element): void {
    const rows = [...rowsOf(list), ...asideOf(list)]
    rows.forEach((row, index) => {
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
    const rows = rowsOf(list)
    const here = rows.indexOf(row)
    const sibling = rows[direction === 'up' ? here - 1 : here + 1]
    if (!sibling) return

    // Against the visible rows rather than `previousElementSibling`, because the
    // blank rows sit among them in the DOM and swapping with one of those would
    // look like a button that did nothing.
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
 * Takes a row out of the form, keeping what is in it.
 *
 * Every field it holds is disabled, so none of them is submitted and the server
 * sees no `item-N-` keys for this index at all. Nothing is deleted and nothing
 * reaches the server until Save, so this is undoable for as long as the page is
 * open — which is what the "Undo" beside it is.
 *
 * Only fields this file disabled are re-enabled later, which is why they are
 * marked. A file input on a service with no asset bucket is already disabled
 * and must stay that way; blanket re-enabling would offer an upload that cannot
 * happen.
 */
function remove(list: Element, row: HTMLElement): void {
    row.classList.add(REMOVED)
    for (const field of fieldsOf(row)) {
        const control = field as HTMLInputElement
        if (control.disabled) continue
        control.dataset[MINE] = 'yes'
        control.disabled = true
    }

    renumber(list)
    refreshArrows(list)

    // Focus goes to the Undo that replaced the button just pressed, so the
    // mistake and its remedy are the same keystroke twice.
    row.querySelector<HTMLButtonElement>('[data-undo]')?.focus()
}

/** Puts it back, exactly as it was. */
function undo(list: Element, row: HTMLElement): void {
    row.classList.remove(REMOVED)
    for (const field of fieldsOf(row)) {
        const control = field as HTMLInputElement
        if (control.dataset[MINE] !== 'yes') continue
        delete control.dataset[MINE]
        control.disabled = false
    }

    renumber(list)
    refreshArrows(list)
    row.querySelector<HTMLButtonElement>('[data-remove]')?.focus()
}

/**
 * The index a new row's fields can use: one past the highest in the form.
 *
 * Counting rows would not do. Indices go with rows, not positions, and the
 * server reads whichever ones turn up — so after a row has been added and
 * another removed, the count and the highest index disagree, and reusing one
 * would make two rows the same row.
 */
function nextIndex(list: Element): number {
    let highest = -1
    for (const field of fieldsOf(list)) {
        const match = /^item-(\d+)-/.exec(field.getAttribute('name') ?? '')
        if (match) highest = Math.max(highest, Number(match[1]))
    }
    return highest + 1
}

/** Points a cloned row's fields at an index of its own. */
function reindex(row: ParentNode, index: number): void {
    for (const field of fieldsOf(row)) {
        const name = field.getAttribute('name') ?? ''
        field.setAttribute('name', name.replace(/^item-\d+-/, `item-${index}-`))
    }
}

/**
 * Adds an empty row of the asked-for kind at the end of the list.
 *
 * Cloned from the blank row the server rendered, which is what carries Astro's
 * scoped styling, the file input's `accept` list, the disabled states and the
 * remove box — none of which this file would get right by building markup, and
 * all of which would go quietly wrong as the page changed. The clone is taken
 * before anybody can type into the original, so what is cloned is genuinely
 * empty even if somebody has since filled the blank row in with the script off.
 */
function add(list: Element, templates: Map<string, HTMLElement>, kind: string): void {
    const template = templates.get(kind)
    if (!template) return

    const row = template.cloneNode(true) as HTMLElement
    row.classList.remove(BLANK)
    reindex(row, nextIndex(list))

    // Before the blank rows rather than at the very end, so the DOM order is
    // the order somebody sees — which is what `renumber` reads.
    list.insertBefore(row, blanksOf(list)[0] ?? null)
    renumber(list)
    refreshArrows(list)

    row.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="file"]')?.focus()
}

/**
 * Takes the list over: adding, ordering, and the class that reveals both.
 *
 * Idempotent, and it refuses politely when there is nothing to enhance: a page
 * without a description list is every other page in the admin.
 */
export function enhance(root: ParentNode = document): void {
    const list = root.querySelector('[data-reorder]')
    const section = list?.closest('section') ?? list
    if (!list || !section || section.classList.contains(ENHANCED)) return

    // Disabled rows are the read-only rendering, before the ownership flip.
    // Enhancing them would offer a control that cannot do anything.
    if (list.querySelector('input[name$="-position"]:disabled')) return

    const templates = new Map<string, HTMLElement>()
    for (const blank of blanksOf(list)) templates.set(kindOf(blank), blank.cloneNode(true) as HTMLElement)

    list.addEventListener('click', (event) => {
        const target = event.target as Element | null
        const row = target?.closest<HTMLElement>('[data-row]')
        if (!row) return

        const move_ = target?.closest<HTMLButtonElement>('[data-move]')
        if (move_ && !move_.disabled) return move(list, row, move_.dataset.move === 'up' ? 'up' : 'down')

        const remove_ = target?.closest<HTMLButtonElement>('[data-remove]')
        if (remove_ && !remove_.disabled) return remove(list, row)

        const undo_ = target?.closest<HTMLButtonElement>('[data-undo]')
        if (undo_ && !undo_.disabled) return undo(list, row)
    })

    section.addEventListener('click', (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-add]')
        if (!button || button.disabled) return
        add(list, templates, button.dataset.add ?? 'paragraph')
    })

    section.classList.add(ENHANCED)
    renumber(list)
    refreshArrows(list)
}
