/**
 * Keeps the women's par placeholder showing the men's par beside it.
 *
 * The scorecard's **Par ♀** column is empty wherever the two cards agree, and
 * shows the men's par greyed out so that the box reads as "the same as this"
 * rather than as a gap. The server renders that placeholder from the stored
 * par, which is right until somebody changes the par in the box next to it —
 * after which the grid quietly claims a hole is a par 4 and offers 5 as the
 * women's default, and the person reading it has to know which of the two to
 * believe.
 *
 * So the placeholder follows the box. Nothing else changes: the value stays
 * whatever it was, because a women's par somebody typed is theirs and not this
 * file's to revise, and the server already treats a women's par equal to the
 * men's as agreement rather than as a difference.
 *
 * The fourth enhancement in this admin and the smallest. As with the others,
 * the page is complete before it runs: with the script off the placeholder is
 * the stored par, which is exactly what it was before any of this.
 */

/** Emptying the men's par puts the placeholder back to what was stored. */
const STORED = 'storedPar'

const ladiesIn = (row: Element): HTMLInputElement | null =>
    row.querySelector<HTMLInputElement>('[name$="-parLadies"]')

/**
 * Follows the men's par with the placeholder beside it.
 *
 * Delegated from the table rather than bound per row, so a row this did not see
 * — there is no control that adds one today, but `+ Add tee` was not always
 * there either — is covered without anybody remembering this file.
 */
export function enhance(root: ParentNode = document): void {
    const holes = root.querySelector('[data-holes]')
    if (!holes) return

    // Disabled boxes are the read-only rendering, before the ownership flip.
    if (holes.querySelector('input[name$="-par"]:disabled')) return

    holes.addEventListener('input', (event) => {
        const target = event.target as HTMLInputElement | null
        if (!target?.name.match(/^hole-\d+-par$/)) return

        const row = target.closest('tr')
        const ladies = row && ladiesIn(row)
        if (!ladies) return

        // Kept the first time it is needed rather than read up front, so this
        // costs nothing on a page nobody edits.
        if (ladies.dataset[STORED] === undefined) ladies.dataset[STORED] = ladies.placeholder

        const typed = target.value.trim()
        ladies.placeholder = typed === '' ? (ladies.dataset[STORED] ?? '') : typed
    })
}
