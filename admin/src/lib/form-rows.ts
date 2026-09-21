/**
 * The parts two repeating groups in the course editor have in common.
 *
 * Both the description and the tee table are rows of fields named
 * `<prefix>-<index>-<field>`, both can gain a row, and both can lose one. What
 * differs is everything visible — one is a stack of textareas and pictures, the
 * other is a table — so what is shared here is the bookkeeping and nothing else.
 *
 * ## The two ideas worth knowing
 *
 * **A removed row is a disabled row.** A disabled field is not submitted, so a
 * row whose fields are all disabled arrives as no keys at all and the server
 * reads it as a row that is not there. Nothing is detached and nothing is lost,
 * which is what makes an Undo a matter of turning the fields back on.
 *
 * That only works because the server reads whichever indices turn up rather
 * than counting rows — `formIndices` in `courses/details.ts`. With a count, a
 * missing `item-1` would make the server read the row after it as this one.
 *
 * **A new row is a clone of one the server rendered.** An element built in
 * script carries none of Astro's scoping attributes and comes out unstyled, and
 * it would be missing whatever `accept` lists, placeholders and disabled states
 * the page already knows how to render. So the page renders an empty row, hides
 * it, and this clones it.
 */

/** Marks a field the script disabled, so an undo re-enables only those. */
const MINE = 'wasEnabled'

/** Every field of a row, whatever the row is made of. */
export const fieldsIn = (row: ParentNode, prefix: string): HTMLInputElement[] => [
    ...row.querySelectorAll<HTMLInputElement>(`[name^="${prefix}-"]`),
]

/**
 * Turns a row off: still in the form, still holding what it held, submitted
 * nowhere.
 *
 * Fields that were already disabled are left alone and not marked, because they
 * are disabled for their own reasons — a file input on a service with no asset
 * bucket, every field on a page rendered before the ownership flip — and
 * turning them back on later would offer something that cannot work.
 */
export function disableRow(row: ParentNode, prefix: string): void {
    for (const field of fieldsIn(row, prefix)) {
        if (field.disabled) continue
        field.dataset[MINE] = 'yes'
        field.disabled = true
    }
}

/** Turns back on exactly what `disableRow` turned off. */
export function enableRow(row: ParentNode, prefix: string): void {
    for (const field of fieldsIn(row, prefix)) {
        if (field.dataset[MINE] !== 'yes') continue
        delete field.dataset[MINE]
        field.disabled = false
    }
}

/**
 * The index a new row's fields can use: one past the highest in the group.
 *
 * Counting rows would not do. Indices belong to rows, not to positions, so
 * after a row has been added and another removed the count and the highest
 * index disagree — and reusing an index makes two rows into one.
 */
export function nextIndex(group: ParentNode, prefix: string): number {
    let highest = -1
    for (const field of fieldsIn(group, prefix)) {
        const match = new RegExp(`^${prefix}-(\\d+)-`).exec(field.getAttribute('name') ?? '')
        if (match) highest = Math.max(highest, Number(match[1]))
    }
    return highest + 1
}

/** Points a cloned row's fields at an index of its own. */
export function reindex(row: ParentNode, prefix: string, index: number): void {
    for (const field of fieldsIn(row, prefix)) {
        const name = field.getAttribute('name') ?? ''
        field.setAttribute('name', name.replace(new RegExp(`^${prefix}-\\d+-`), `${prefix}-${index}-`))
    }
}
