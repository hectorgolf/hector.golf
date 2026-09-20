import { describe, expect, it } from 'vitest'

import {
    RETIRED_AFTER_ABSENT_EVENTS,
    playerBiographyInput,
    type BiographyContext,
} from '@hector/schemas/src/biographies.ts'
import { EventFormat, type HectorEvent } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'

/**
 * What the generator is told about a player, and the flag that was inverted.
 *
 * `update-player-biographies.ts` built this from events in `glob` order — an
 * indeterminate filesystem walk, per that package's own README — and then read
 * `pastAppearances[0]` as the player's *last* appearance. Under the alphabetical
 * order it happened to get, that was their *first*, so `retired` meant "debuted
 * in 2022 or later" and disagreed with the dates for 15 of the 45 players.
 *
 * It is not a cosmetic field: it reaches the prompt as "Considered as retired
 * from Hector events" or "Still active in Hector events", so it decides how a
 * real person is described on a published page. These are the assertions that
 * stop it drifting back.
 */

const TODAY = '2026-09-20'

const event = (year: number, participants: string[] = [], winners?: HectorEvent['results']): HectorEvent =>
    ({
        id: `HECTOR${year}`,
        format: EventFormat.Hector,
        name: `Hector ${year}`,
        location: 'Somewhere',
        timing: { start: `${year}-09-01`, end: `${year}-09-04` },
        participants,
        ignore: false,
        maxStrokesOverPar: 4,
        ...(winners ? { results: winners } : {}),
    }) as HectorEvent

const player = (id = 'eero-s', fields: Partial<Player> = {}): Player => ({
    id,
    name: { first: 'Eero', last: 'Somervuo' },
    contact: { phone: '+358000000000' },
    ...fields,
})

const context = (hectorEvents: HectorEvent[], extra: Partial<BiographyContext> = {}): BiographyContext => ({
    hectorEvents,
    today: TODAY,
    homeClub: 'Tapiola Golf',
    otherGeneratedBiographies: [],
    ...extra,
})

/** Thirteen past Hectors, 2013–2025, so the 7-event threshold is reachable. */
const thirteenYears = (participantsByYear: Record<number, string[]> = {}) =>
    Array.from({ length: 13 }, (_, i) => event(2013 + i, participantsByYear[2013 + i] ?? []))

describe('whether a player counts as retired', () => {
    it('is measured from the most recent appearance, not the first', () => {
        // Played the first year and never again: long gone, whatever the order.
        const events = thirteenYears({ 2013: ['eero-s'] })
        expect(playerBiographyInput(player(), context(events)).retired).toBe(true)
    })

    it('does not care what order the events arrive in', () => {
        const events = thirteenYears({ 2013: ['eero-s'] })
        const shuffled = [...events].reverse()
        expect(playerBiographyInput(player(), context(shuffled)).retired).toBe(true)
        expect(playerBiographyInput(player(), context(events)).retired).toBe(true)
    })

    /**
     * The inversion, stated as a test. Under the old expression a player whose
     * first appearance was recent scored a high index and was called retired —
     * which is the opposite of what the data says.
     */
    it('calls a player who played last year active, not retired', () => {
        const events = thirteenYears({ 2025: ['eero-s'] })
        expect(playerBiographyInput(player(), context(events)).retired).toBe(false)
    })

    it('counts the Hectors missed since, against the threshold', () => {
        const justInside = thirteenYears({ 2018: ['eero-s'] }) // 2019..2025 missed = 7
        expect(playerBiographyInput(player(), context(justInside)).retired).toBe(false)

        const justOutside = thirteenYears({ 2017: ['eero-s'] }) // 2018..2025 missed = 8
        expect(playerBiographyInput(player(), context(justOutside)).retired).toBe(true)
        expect(RETIRED_AFTER_ABSENT_EVENTS).toBe(7)
    })

    /**
     * The other half of the old bug: with no appearances it fell back to the
     * whole event count, so a debutant in the upcoming Hector was introduced to
     * the model as having retired from it.
     */
    it('does not retire somebody who has never played', () => {
        const events = [...thirteenYears(), event(2027, ['eero-s'])]
        const input = playerBiographyInput(player(), context(events))

        expect(input.retired).toBe(false)
        expect(input.previousAppearances).toEqual([])
        expect(input.nextEvent).toEqual({ name: 'Hector 2027', year: 2027, participates: true })
    })
})

describe('the rest of what the generator is told', () => {
    it('lists appearances oldest first, and only the past ones', () => {
        const events = [...thirteenYears({ 2015: ['eero-s'], 2020: ['eero-s'] }), event(2027, ['eero-s'])]
        const input = playerBiographyInput(player(), context(events))

        expect(input.previousAppearances.map((a) => a.year)).toEqual([2015, 2020])
        expect(input.allPastEvents).toHaveLength(13)
    })

    /** A winner appeared, whether or not the field list says so. */
    it('counts a win as an appearance even when the field does not list them', () => {
        const events = thirteenYears()
        events[2] = event(2015, [], { winners: { hector: ['eero-s'] } })
        const input = playerBiographyInput(player(), context(events))

        expect(input.previousAppearances.map((a) => a.year)).toEqual([2015])
        expect(input.hectorWins.map((w) => w.year)).toEqual([2015])
    })

    it('takes the nearest upcoming Hector that has a field', () => {
        const events = [...thirteenYears(), event(2029, ['someone']), event(2027, ['someone'])]
        expect(playerBiographyInput(player(), context(events)).nextEvent?.year).toBe(2027)
    })

    it('ignores an upcoming Hector nobody has entered yet', () => {
        const events = [...thirteenYears(), event(2027, [])]
        expect(playerBiographyInput(player(), context(events)).nextEvent).toBeUndefined()
    })

    it('passes through what the caller resolved and the player carries', () => {
        const input = playerBiographyInput(
            player('eero-s', { gender: 'female', misc: ['Plays left-handed'] }),
            context(thirteenYears(), { otherGeneratedBiographies: ['Somebody else already said this.'] })
        )

        expect(input.name).toBe('Eero')
        expect(input.gender).toBe('female')
        expect(input.homeClub).toBe('Tapiola Golf')
        expect(input.miscellaneousDetails).toEqual(['Plays left-handed'])
        expect(input.otherGeneratedBiographies).toEqual(['Somebody else already said this.'])
    })

    it('defaults gender to male, as the old code did, rather than omitting it', () => {
        expect(playerBiographyInput(player(), context(thirteenYears())).gender).toBe('male')
    })
})
