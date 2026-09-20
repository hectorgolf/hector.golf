import { describe, expect, it } from 'vitest'

import type { Player } from '@hector/schemas/src/players.ts'

import {
    displayName,
    formatHandicap,
    fullName,
    nameById,
    resolveHandicap,
} from '../src/lib/players.ts'

const player = (fields: Partial<Player> = {}): Player => ({
    id: 'lasse-k',
    name: { first: 'Lasse', last: 'Koskela' },
    contact: { phone: '+358000000000' },
    ...fields,
})

describe('naming a player', () => {
    it('never shortens the last name, whatever the player asked the site to do', () => {
        expect(fullName(player({ privacy: 'shorten-last-name' }))).toBe('Lasse Koskela')
    })

    it('falls back to the id, so a reference to a player who is gone is visible', () => {
        const names = nameById([player()])
        expect(displayName(names, 'lasse-k')).toBe('Lasse Koskela')
        expect(displayName(names, 'jussi-allonen-hcp070')).toBe('jussi-allonen-hcp070')
        expect(displayName(names, undefined)).toBe('—')
    })
})

/**
 * The order is the whole test, and it is the site's:
 * `resolveHandicap(fromTheHistory, player.handicap)`. `player.handicap` is a
 * stopgap for a player WiseGolf has never heard of, not an override, so a
 * reading always beats it — otherwise a value nobody maintains any more would
 * shadow one that is scraped four times a day.
 *
 * `Roster.astro` had these the other way round, under a comment claiming it was
 * the site's order. It was, before the precedence was reversed on 2026-09-18.
 */
describe('resolving a handicap, and saying where it came from', () => {
    it('prefers what WiseGolf last reported over a hand-set figure', () => {
        expect(resolveHandicap(player({ handicap: 25 }), { handicap: 18.3 })).toEqual({
            value: 18.3,
            source: 'observed',
            observed: undefined,
        })
    })

    it('keeps the reading date when the snapshot has one', () => {
        expect(
            resolveHandicap(player(), { handicap: 18.3, observed: '2026-09-19T03:02:42Z' })
        ).toEqual({ value: 18.3, source: 'observed', observed: '2026-09-19T03:02:42Z' })
    })

    it('falls back to the stopgap, which is the case the field exists for', () => {
        expect(resolveHandicap(player({ handicap: 25 }), undefined)).toEqual({
            value: 25,
            source: 'stopgap',
        })
    })

    it('answers nothing for a player neither source knows, rather than a zero', () => {
        expect(resolveHandicap(player(), undefined)).toBeUndefined()
    })

    it('keeps a scratch stopgap, 0 being a handicap and not an absence', () => {
        expect(resolveHandicap(player({ handicap: 0 }), undefined)).toEqual({
            value: 0,
            source: 'stopgap',
        })
    })

    it('prints an em dash for nothing, so a column never renders blank', () => {
        expect(formatHandicap(undefined)).toBe('—')
        expect(formatHandicap({ value: -2.8, source: 'observed' })).toBe('-2.8')
    })
})
