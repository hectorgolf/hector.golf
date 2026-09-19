import { describe, expect, it } from 'vitest'

import { hectorEventSchema, type HectorGameFormat } from '@hector/schemas/src/events.ts'

import {
    asPercentage,
    bucketRange,
    bucketsSummary,
    competitionsOf,
    gameFormatDetails,
    maxStrokesOverParOf,
    roundLabel,
} from '../src/lib/events/hector.ts'

const format = (fields: Partial<HectorGameFormat> = {}): HectorGameFormat =>
    ({ format: 'Stableford NET', ...fields }) as HectorGameFormat

describe('naming a round', () => {
    it('uses its place in the schedule, a round having no name of its own', () => {
        expect(roundLabel({ day: 2, round: 1, course: 'emporda-dunes', tee: 'Blue', gameFormats: [] })).toBe(
            'Day 2, round 1'
        )
    })
})

describe('percentages', () => {
    /**
     * `0.33` in the data means a third of a competition, written to two digits by
     * whoever typed it. Multiplying it is where the floating point shows: the
     * rounding is what keeps "33%" out of "33.000000000000004%".
     */
    it('round to whole percent, the data having no finer intent', () => {
        expect(asPercentage(0.33)).toBe('33%')
        expect(asPercentage(1)).toBe('100%')
        expect(asPercentage(0.2)).toBe('20%')
        expect(asPercentage(0)).toBe('0%')
    })
})

describe('describing a game format', () => {
    it('says which competitions it counts towards', () => {
        expect(competitionsOf(format({ competition: ['hector', 'victor'] }))).toBe('Hector & Victor')
        expect(competitionsOf(format({ competition: ['victor'] }))).toBe('Victor')
    })

    it('says "Neither" rather than nothing, a round outside both being a real thing', () => {
        expect(competitionsOf(format())).toBe('Neither')
    })

    it('calls a zero allowance scratch, which is what it is called on a card', () => {
        expect(gameFormatDetails(format({ handicapAllowance: 0 }))).toEqual(['scratch'])
    })

    it('lists contributions in a fixed order, not the order the file happened to use', () => {
        const hectorFirst = gameFormatDetails(format({ contribution: { hector: 0.5, victor: 1 } }))
        const victorFirst = gameFormatDetails(format({ contribution: { victor: 1, hector: 0.5 } }))
        expect(hectorFirst).toEqual(['50% of the Hector', '100% of the Victor'])
        expect(victorFirst).toEqual(hectorFirst)
    })

    it('spells out the opening-shots rule, with and without a penalty', () => {
        expect(
            gameFormatDetails(
                format({
                    format: 'Scramble Stroke Play NET',
                    openingShotsRequirement: { minimumPerPlayer: 6 },
                })
            )
        ).toEqual(['6 opening shots each'])

        expect(
            gameFormatDetails(
                format({
                    format: 'Scramble Stroke Play NET',
                    openingShotsRequirement: { minimumPerPlayer: 4, penaltyPerMissingStroke: 2 },
                })
            )
        ).toEqual(['4 opening shots each, 2 per missing one'])
    })

    it('says nothing about fields the format does not carry', () => {
        expect(gameFormatDetails(format())).toEqual([])
    })

    it('puts a round of HECTOR2025 into one line', () => {
        expect(
            gameFormatDetails(
                format({
                    competition: ['hector', 'victor'],
                    handicapAllowance: 1,
                    contribution: { hector: 0.33, victor: 1 },
                    teamContribution: 'better',
                })
            ).join(' · ')
        ).toBe('100% handicap allowance · the better partner scores · 33% of the Hector · 100% of the Victor')
    })
})

describe('the maximum score a hole can cost', () => {
    /**
     * The event's rule is defaulted by the schema and a round's is not, because
     * an absent round value means "whatever the event plays" rather than a number
     * of its own. So this reads the pair rather than either alone.
     */
    const event = hectorEventSchema.parse({
        id: 'HECTOR2027',
        format: 'hector',
        name: 'Hector 2027',
        location: 'Somewhere',
        timing: { start: '2027-09-24', end: '2027-09-27' },
        participants: [],
    })

    it('falls back to the event rule when a round does not depart from it', () => {
        expect(maxStrokesOverParOf(event, { day: 1, round: 1, course: 'c', tee: 'Yellow', gameFormats: [] })).toBe(4)
    })

    it('takes a round’s own value where there is one', () => {
        expect(
            maxStrokesOverParOf(event, {
                day: 1,
                round: 1,
                course: 'c',
                tee: 'Yellow',
                maxStrokesOverPar: 5,
                gameFormats: [],
            })
        ).toBe(5)
    })
})

describe('summarising a split', () => {
    const bucket = (...handicaps: (number | undefined)[]) =>
        handicaps.map((handicap, index) => ({ id: `p${index}`, handicap }))

    it('collapses equal buckets, which is HECTOR2025 at 24 players', () => {
        expect(bucketsSummary([bucket(1, 2), bucket(3, 4)])).toBe('2 buckets of 2')
    })

    /**
     * A Hector's field is whoever signed up, so the even split is luck. "3
     * buckets" alone does not say whether one of them is short, which is exactly
     * what somebody checking a Draft wants to know.
     */
    it('spells out the sizes when they differ', () => {
        expect(bucketsSummary([bucket(1, 2, 3), bucket(4, 5), bucket(6, 7)])).toBe('3 buckets: 3, 2, 2')
    })

    it('says no split rather than "0 buckets" for an event with none', () => {
        expect(bucketsSummary(undefined)).toBe('No split drawn')
        expect(bucketsSummary([])).toBe('No split drawn')
    })

    it('gives a bucket the handicap span it was drawn on', () => {
        expect(bucketRange(bucket(-2.8, 5.5, 10.6))).toBe('-2.8 to 10.6')
        expect(bucketRange(bucket(7))).toBe('7')
    })

    it('has nothing to say about a bucket whose entries carry no handicap', () => {
        expect(bucketRange(bucket(undefined, undefined))).toBeUndefined()
    })
})
