import { describe, expect, it } from 'vitest'

import { matchplayEventSchema } from '@hector/schemas/src/events.ts'
import { detailsFromForm } from '../src/lib/matchplay/details.ts'

/**
 * The create page and the edit page both submit these four fields, and both read
 * them through here. What is worth pinning is the normalising — the edit page
 * writes over a tournament that already exists, so a rule that differed between
 * the two would quietly rewrite a stored value on the first correction.
 */
describe("reading a tournament's details out of a form", () => {
    it('trims the prose, which is otherwise stored with whatever was pasted', () => {
        const details = detailsFromForm({
            name: '  Hector Matchplay 2027  ',
            location: '\tFinland\n',
            start: '2027-05-01',
            end: '2027-09-01',
            description: '  Sixteen players.  ',
        })

        expect(details.name).toBe('Hector Matchplay 2027')
        expect(details.location).toBe('Finland')
        expect(details.description).toBe('Sixteen players.')
    })

    it('drops an emptied description rather than storing an empty one', () => {
        expect(detailsFromForm({ description: '   ' }).description).toBeUndefined()
        expect(detailsFromForm({}).description).toBeUndefined()
    })

    it('leaves the dates alone, so the schema is the one thing judging them', () => {
        const details = detailsFromForm({ start: '2027-02-30', end: 'whenever' })
        expect(details.timing).toEqual({ start: '2027-02-30', end: 'whenever' })
    })
})

/**
 * The edit page merges the details into the stored event and validates the whole
 * thing. These are the two ways that can go wrong on a tournament that has
 * already been played.
 */
describe('editing a finished tournament', () => {
    const finished = {
        id: 'HECTORMATCHPLAY2027',
        name: 'Hector Matchplay 2027',
        location: 'Finland',
        timing: { start: '2027-05-01', end: '2027-09-01' },
        format: 'matchplay' as const,
        status: 'complete' as const,
        participants: ['aa', 'bb'],
        results: {
            winners: { matchplay: 'aa' },
            bracket: [
                {
                    round: 1,
                    matches: [
                        {
                            id: 'r1m1',
                            leftSource: null,
                            rightSource: null,
                            left: 'aa',
                            right: 'bb',
                            score: '2&1',
                            winner: 'aa',
                        },
                    ],
                },
            ],
        },
    }

    it('keeps the bracket, the field and the status the edit never asked about', () => {
        const edited = matchplayEventSchema.parse({
            ...finished,
            ...detailsFromForm({
                name: 'Hector Matchplay 2027 (Kytäjä)',
                location: 'Kytäjä, Finland',
                start: finished.timing.start,
                end: finished.timing.end,
                description: 'Sixteen players.',
            }),
        })

        expect(edited.name).toBe('Hector Matchplay 2027 (Kytäjä)')
        expect(edited.status).toBe('complete')
        expect(edited.participants).toEqual(['aa', 'bb'])
        expect(edited.results?.winners.matchplay).toBe('aa')
        expect(edited.results?.bracket[0]?.matches[0]?.score).toBe('2&1')
    })

    it('refuses dates that end before they start, whatever the status', () => {
        const parsed = matchplayEventSchema.safeParse({
            ...finished,
            ...detailsFromForm({
                name: finished.name,
                location: finished.location,
                start: '2027-09-01',
                end: '2027-05-01',
            }),
        })

        expect(parsed.success).toBe(false)
    })
})
