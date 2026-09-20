import { describe, expect, it } from 'vitest'

import type { Player } from '@hector/schemas/src/players.ts'

import {
    biographyWasEdited,
    detailsFromForm,
    formOf,
    hintsFrom,
    paragraphsFrom,
} from '../src/lib/players/details.ts'

/**
 * What the player editor makes of a filled-in form.
 *
 * The page itself is Astro and posts to itself; these are the decisions inside
 * it that are worth pinning because getting them wrong is quiet. A biography
 * split on the wrong character publishes six paragraphs where there was one; an
 * emptied box that writes `""` instead of dropping the field commits a value the
 * site has to render around; and a lock set on the wrong edit stops a biography
 * improving without anybody noticing.
 */

const player = (fields: Partial<Player> = {}): Player => ({
    id: 'eero-s',
    name: { first: 'Eero', last: 'Somervuo' },
    contact: { phone: '+358000000000' },
    ...fields,
})

describe('filling the boxes from a stored player', () => {
    it('joins hints by line and paragraphs by blank line', () => {
        const form = formOf(player({ misc: ['Plays left-handed', 'Owns a dog'], biography: ['One.', 'Two.'] }))

        expect(form.misc).toBe('Plays left-handed\nOwns a dog')
        expect(form.biography).toBe('One.\n\nTwo.')
    })

    it('shows empty boxes for the fields a player does not have', () => {
        expect(formOf(player())).toEqual({ club: '', handicap: '', misc: '', biography: '' })
    })

    /**
     * The box holds `player.handicap`, which is the stopgap. Putting the
     * *observed* figure there would invite somebody to save a number they do not
     * own — writing a stopgap that then shadows the real reading until some
     * unrelated job next rewrote that player.
     */
    it('shows the stored stopgap, and nothing when there is none', () => {
        expect(formOf(player({ handicap: 12.4 })).handicap).toBe('12.4')
        expect(formOf(player()).handicap).toBe('')
    })
})

describe('splitting a biography into paragraphs', () => {
    it('breaks on blank lines', () => {
        expect(paragraphsFrom('One.\n\nTwo.\n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
    })

    /**
     * The case the whole function exists for. A textarea wraps visually but a
     * person pressing Return once is continuing a paragraph, not starting one —
     * and treating every newline as a break turns one paragraph into six on the
     * public page.
     */
    it('joins single newlines back into one paragraph', () => {
        expect(paragraphsFrom('A sentence\nthat was wrapped\nby hand.')).toEqual(['A sentence that was wrapped by hand.'])
    })

    it('tolerates the whitespace a real paste carries', () => {
        expect(paragraphsFrom('  One.  \n   \n\n  Two.  \n')).toEqual(['One.', 'Two.'])
    })

    it('answers nothing for an empty box', () => {
        expect(paragraphsFrom('')).toEqual([])
        expect(paragraphsFrom('\n  \n')).toEqual([])
    })
})

describe('splitting hints', () => {
    /** A hint is a line, not a paragraph — they are short, and there are few. */
    it('takes one per line, blank lines dropped', () => {
        expect(hintsFrom('Plays left-handed\n\n  Owns a dog  \n')).toEqual(['Plays left-handed', 'Owns a dog'])
    })
})

describe('reading the four fields off the form', () => {
    it('trims what was typed', () => {
        expect(detailsFromForm({ club: '  TaG  ', handicap: ' 12.4 ', misc: '', biography: '' }).club).toBe('TaG')
    })

    /**
     * Absent rather than empty, in every case. The schema leaves optional fields
     * out and `export.ts` writes what the schema produces, so a committed
     * `"club": ""` would be a value the site has to render around where
     * `undefined` is a state it already handles.
     */
    it('leaves an emptied box out rather than writing an empty value', () => {
        expect(detailsFromForm({ club: '   ', handicap: '', misc: '\n\n', biography: '  ' })).toEqual({
            club: undefined,
            handicap: undefined,
            misc: undefined,
            biography: undefined,
        })
    })

    /**
     * Not coerced to "no handicap". Discarding what was typed and reporting a
     * successful save is the one outcome a person cannot detect; `NaN` reaches
     * the schema, which refuses it, and the page says so.
     */
    it('lets a handicap that is not a number reach the schema as NaN', () => {
        expect(detailsFromForm({ club: '', handicap: 'about twelve', misc: '', biography: '' }).handicap).toBeNaN()
    })

    it('reads a handicap that is a number', () => {
        expect(detailsFromForm({ club: '', handicap: '12.4', misc: '', biography: '' }).handicap).toBe(12.4)
    })
})

describe('whether saving claims the biography', () => {
    const stored = player({ biography: ['One.', 'Two.'] })
    const form = (biography: string) => detailsFromForm({ ...formOf(stored), biography })

    /**
     * `data-ownership.md` is explicit that saving an edit *is* the act of
     * claiming the field, rather than a checkbox beside it: a lock somebody
     * forgets to tick is indistinguishable from no lock at all on the day the
     * job next runs, and it runs twice a month.
     */
    it('claims it when the text changed', () => {
        expect(biographyWasEdited(stored, form('One.\n\nTwo, corrected.'))).toBe(true)
    })

    it('claims it when a paragraph was added or removed', () => {
        expect(biographyWasEdited(stored, form('One.\n\nTwo.\n\nThree.'))).toBe(true)
        expect(biographyWasEdited(stored, form('One.'))).toBe(true)
    })

    /**
     * The other half, and the one that stops the lock being set by accident: a
     * save that only changed the club must not claim a biography nobody touched,
     * or the generator's own output stops improving and nobody notices.
     */
    it('does not claim it when only another field changed', () => {
        const details = detailsFromForm({ ...formOf(stored), club: 'TaG' })
        expect(biographyWasEdited(stored, details)).toBe(false)
    })

    it('does not claim it when the text was only re-wrapped', () => {
        expect(biographyWasEdited(stored, form('One.\n\nTwo.'))).toBe(false)
    })

    it('claims a biography written onto a player who had none', () => {
        expect(biographyWasEdited(player(), form('Something.'))).toBe(true)
    })
})
