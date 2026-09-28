import { describe, expect, it } from 'vitest'

import type { Player } from '@hector/schemas/src/players.ts'

import {
    biographyWasEdited,
    detailsFromForm,
    formOf,
    hintsFrom,
    paragraphsFrom,
    playerWithApprovedDraft,
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

describe('approving a biography draft', () => {
    const WRITTEN = '2026-09-28T09:00:00.000Z'
    const draft = { biography: ['Drafted one.', 'Drafted two.'], generatedAt: WRITTEN, promptHash: 'abc123' }

    it('saves the draft as it stands without locking it', () => {
        const approved = playerWithApprovedDraft(player({ biography: ['Old.'] }), draft, 'Drafted one.\n\nDrafted two.')

        expect(approved.biography).toEqual(draft.biography)
        expect(approved.biographyLocked).toBeUndefined()
    })

    it('locks a draft the reviewer changed', () => {
        const approved = playerWithApprovedDraft(player({ biography: ['Old.'] }), draft, 'Drafted one.\n\nFixed two.')

        expect(approved.biography).toEqual(['Drafted one.', 'Fixed two.'])
        expect(approved.biographyLocked).toBe(true)
    })

    it('keeps a lock somebody set after the draft was written', () => {
        const approved = playerWithApprovedDraft(player({ biographyLocked: true }), draft, 'Drafted one.\n\nDrafted two.')

        expect(approved.biographyLocked).toBe(true)
    })

    /**
     * The date the model wrote it, not the date somebody got round to reading
     * it. `biographiesToRegenerate` reads this to decide whether the text can
     * know about an event that has since been played, and only the generation
     * date answers that — a draft written mid-tournament and approved the
     * following week still describes it as upcoming.
     */
    it('records when the model wrote it, not when it was approved', () => {
        const approved = playerWithApprovedDraft(player(), draft, 'Drafted one.\n\nDrafted two.')

        expect(approved.biographyGeneratedAt).toBe(WRITTEN)
    })

    it('records it for an edited draft too, since the text is still the model\'s work', () => {
        const approved = playerWithApprovedDraft(player(), draft, 'Drafted one.\n\nFixed two.')

        expect(approved.biographyGeneratedAt).toBe(WRITTEN)
    })

    /** A date on a biography that is not there would claim a run produced it. */
    it('leaves no date when the reviewer empties the box', () => {
        const approved = playerWithApprovedDraft(player({ biography: ['Old.'] }), draft, '   ')

        expect(approved.biography).toBeUndefined()
        expect(approved.biographyGeneratedAt).toBeUndefined()
        expect(approved.biographyPromptHash).toBeUndefined()
    })

    /**
     * The fingerprint of the facts the draft was generated from, which is what
     * the next run compares against. The draft's, not one recomputed now: a
     * draft written on Monday and approved on Thursday reflects Monday's facts,
     * and stamping it with Thursday's would declare a biography current about an
     * event it has never heard of.
     */
    it('records the fingerprint the draft was generated from', () => {
        const approved = playerWithApprovedDraft(player(), draft, 'Drafted one.\n\nDrafted two.')

        expect(approved.biographyPromptHash).toBe('abc123')
    })

    /**
     * An edit does not clear it. The fingerprint records which facts the text
     * was written *from*, not how faithful the text is to them — somebody
     * rewording a paragraph has not made it describe a different tournament, and
     * clearing it would ask for a fresh draft on every run forever.
     */
    it('keeps the fingerprint when the reviewer edits the text', () => {
        const approved = playerWithApprovedDraft(player(), draft, 'Drafted one.\n\nRewritten by hand.')

        expect(approved.biographyLocked).toBe(true)
        expect(approved.biographyPromptHash).toBe('abc123')
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
