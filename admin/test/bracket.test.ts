import { describe, expect, it } from 'vitest'

import {
    championOf,
    drawBracket,
    isDrawableFieldSize,
    nextDrawableSize,
    orderForDraw,
    playableMatches,
    recordResult,
} from '../src/lib/matchplay/bracket'

const field = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i + 1}`)

describe('field sizes', () => {
    it('accepts only powers of two, because anything else leaves a player unpaired', () => {
        expect([2, 4, 8, 16, 32].every(isDrawableFieldSize)).toBe(true)
        expect([0, 1, 3, 6, 12, 15, 17].some(isDrawableFieldSize)).toBe(false)
    })

    it('says how far off a field is', () => {
        expect(nextDrawableSize(12)).toBe(16)
        expect(nextDrawableSize(16)).toBe(16)
    })
})

describe('ordering the field', () => {
    it('uses the injected shuffle, so a draw can be reproduced', () => {
        const reverse = (xs: string[]) => [...xs].reverse()
        expect(orderForDraw(field(4), reverse)).toEqual(['p4', 'p3', 'p2', 'p1'])
    })

    it('keeps the whole field, once each, however it shuffles', () => {
        const ordered = orderForDraw(field(16))
        expect([...ordered].sort()).toEqual([...field(16)].sort())
    })

    it('leaves the caller\'s field alone', () => {
        const original = field(8)
        orderForDraw(original)
        expect(original).toEqual(field(8))
    })
})

describe('drawing a bracket', () => {
    it('builds every round down to the final, for 16 players', () => {
        const bracket = drawBracket(field(16))
        expect(bracket.map((r) => r.matches.length)).toEqual([8, 4, 2, 1])
        expect(bracket.flatMap((r) => r.matches)).toHaveLength(15)
    })

    it('numbers matches M01 upward in bracket order, as the existing events do', () => {
        const ids = drawBracket(field(16)).flatMap((r) => r.matches.map((m) => m.id))
        expect(ids[0]).toBe('M01')
        expect(ids.at(-1)).toBe('M15')
    })

    it('seats the field in the first round and leaves later rounds waiting', () => {
        const bracket = drawBracket(field(8))
        expect(bracket[0]!.matches[0]).toMatchObject({ left: 'p1', right: 'p2', leftSource: null })
        expect(bracket[1]!.matches[0]).toMatchObject({ left: null, right: null, leftSource: 'M01', rightSource: 'M02' })
    })

    it('refuses a field that cannot halve cleanly, and says what would work', () => {
        expect(() => drawBracket(field(12))).toThrow(/nearest workable size is 16/)
    })
})

describe('recording a result', () => {
    it('advances the winner into the match that was waiting on it', () => {
        const drawn = drawBracket(field(8))
        const after = recordResult(drawn, { matchId: 'M01', score: '3&1', winner: 'p2' })

        expect(after[0]!.matches[0]).toMatchObject({ score: '3&1', winner: 'p2' })
        expect(after[1]!.matches[0]!.left).toBe('p2')
        // The other slot is still waiting on M02.
        expect(after[1]!.matches[0]!.right).toBeNull()
    })

    it('does not mutate the bracket it was given', () => {
        const drawn = drawBracket(field(4))
        recordResult(drawn, { matchId: 'M01', score: '2&1', winner: 'p1' })
        expect(drawn[0]!.matches[0]!.winner).toBeNull()
    })

    it('refuses a winner who is not in that match', () => {
        const drawn = drawBracket(field(4))
        expect(() => recordResult(drawn, { matchId: 'M01', score: '1UP', winner: 'p4' })).toThrow(
            /not playing in M01/
        )
    })

    it('refuses a match that does not exist', () => {
        expect(() => recordResult(drawFour(), { matchId: 'M99', score: '1UP', winner: 'p1' })).toThrow(
            /No match M99/
        )
    })
})

function drawFour() {
    return drawBracket(field(4))
}

describe('running a whole tournament', () => {
    it('carries the eventual champion to the top, one result at a time', () => {
        let bracket = drawBracket(field(4))
        expect(championOf(bracket)).toBeUndefined()

        bracket = recordResult(bracket, { matchId: 'M01', score: '3&1', winner: 'p1' })
        bracket = recordResult(bracket, { matchId: 'M02', score: '2UP', winner: 'p4' })
        // The final now knows both its players.
        expect(playableMatches(bracket).map((m) => m.id)).toEqual(['M03'])

        bracket = recordResult(bracket, { matchId: 'M03', score: '1UP', winner: 'p4' })
        expect(championOf(bracket)).toBe('p4')
    })

    it('only offers matches whose players are both known', () => {
        const drawn = drawBracket(field(8))
        // Round one only: nothing later has its players yet.
        expect(playableMatches(drawn).map((m) => m.id)).toEqual(['M01', 'M02', 'M03', 'M04'])
    })
})
