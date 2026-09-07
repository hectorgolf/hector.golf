import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { expect, describe, it } from 'vitest'
import RoundsList from '../../src/components/events/RoundsList.astro'
import { hectorEventSchema } from '../../src/schemas/events'


/**
 * A two-round Hector event, parsed through the schema so the maximum-score rule
 * arrives with its default applied — the same route the real event pages take.
 *
 * The courses have to exist: a round whose course cannot be found is skipped
 * entirely, which quietly renders nothing at all.
 */
const eventWith = (over: Record<string, unknown> = {}) => hectorEventSchema.parse({
    id: 'TEST2026',
    format: 'hector',
    name: 'Test Invitational 2026',
    location: 'Nova Scotia, Canada',
    date: 'November 1-2, 2026',
    participants: [],
    rounds: [
        {
            day: 1,
            round: 1,
            course: 'konopiste-radecky',
            tee: 'Yellow',
            // A Stableford format and a Stroke Play one on the same card: only the
            // second is subject to a maximum score per hole.
            gameFormats: [
                { format: 'Stableford NET', handicapAllowance: 1 },
                { format: 'Stroke Play SCR', handicapAllowance: 0 },
            ],
        },
        {
            day: 2,
            round: 1,
            course: 'konopiste-radecky',
            tee: 'Yellow',
            gameFormats: [{ format: 'Scramble Stroke Play NET', handicapAllowance: 0.2 }],
        },
    ],
    ...over,
})

describe('Component <RoundsList/>', async () => {
    const container = await AstroContainer.create()
    const render = (event: unknown) => container.renderToString(RoundsList, {
        props: { event, allThrough: 0 },
    })

    it('shows the maximum score per hole on a stroke play format', async () => {
        const result = await render(eventWith())

        expect(result).toContain('Maximum score per hole: par + 4')
    })

    it('shows it once on a round pairing a Stableford format with a Stroke Play one', async () => {
        const result = await render(eventWith())

        // Round one has two formats; only the Stroke Play half carries the rule.
        const rounds = result.split('class="round ')
        const firstRound = rounds[1] ?? ''
        expect(firstRound).toContain('Stableford NET')
        expect(firstRound).toContain('Stroke Play SCR')
        expect(firstRound.split('Maximum score per hole').length - 1).toEqual(1)
    })

    it('shows it for a Scramble Stroke Play format', async () => {
        const result = await render(eventWith({
            rounds: [{
                day: 1, round: 1, course: 'konopiste-radecky', tee: 'Yellow',
                gameFormats: [{ format: 'Scramble Stroke Play NET', handicapAllowance: 0.2 }],
            }],
        }))

        expect(result).toContain('Maximum score per hole: par + 4')
    })

    it('does not show it for a Stableford-only round', async () => {
        // Stableford already gives nothing for a hole worse than a net bogey.
        const result = await render(eventWith({
            rounds: [{
                day: 1, round: 1, course: 'konopiste-radecky', tee: 'Yellow',
                gameFormats: [{ format: 'Stableford NET', handicapAllowance: 1 }],
            }],
        }))

        expect(result).toContain('Stableford NET')
        expect(result).not.toContain('Maximum score per hole')
    })

    it('does not show it for Scramble Stableford either', async () => {
        const result = await render(eventWith({
            rounds: [{
                day: 1, round: 1, course: 'konopiste-radecky', tee: 'Yellow',
                gameFormats: [{ format: 'Scramble Stableford NET', handicapAllowance: 1 }],
            }],
        }))

        expect(result).not.toContain('Maximum score per hole')
    })

    it('does show it for Better Ball Stableford, which is the exception', async () => {
        const result = await render(eventWith({
            rounds: [{
                day: 1, round: 1, course: 'konopiste-radecky', tee: 'Yellow',
                gameFormats: [{ format: 'Better Ball Stableford NET', handicapAllowance: 1 }],
            }],
        }))

        expect(result).toContain('Maximum score per hole: par + 4')
    })

    it('shows the event\'s own maximum when it sets one', async () => {
        const result = await render(eventWith({ maxStrokesOverPar: 5 }))

        expect(result).toContain('Maximum score per hole: par + 5')
    })

    it('offers a short form for narrow screens, as the other rules do', async () => {
        const result = await render(eventWith())

        expect(result).toContain('Max par + 4')
        expect(result).toContain('maximum-score short')
        expect(result).toContain('maximum-score long')
    })

    it('still shows the handicap allowance alongside it', async () => {
        const result = await render(eventWith())

        expect(result).toContain('100% handicap allowance')
    })

    it('renders nothing when the event has no rounds', async () => {
        const result = await render(eventWith({ rounds: undefined }))

        expect(result).not.toContain('Maximum score per hole')
    })

    it('shows a round its own maximum when it overrides the event', async () => {
        const event = eventWith({ maxStrokesOverPar: 4 })
        const result = await render({
            ...event,
            rounds: [event.rounds![0], { ...event.rounds![1], maxStrokesOverPar: 6 }],
        })

        expect(result).toContain('Maximum score per hole: par + 4')
        expect(result).toContain('Maximum score per hole: par + 6')
    })
})
