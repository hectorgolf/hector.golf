import { describe, expect, it } from 'vitest'

import { EventFormat, type Event } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { run } from '../src/lib/jobs/biographies.ts'

/**
 * Deciding whose biography a run would rewrite, in this service.
 *
 * The decision is all this slice does, and it is the half that can be wrong
 * *silently*: a lock that stops being honoured looks exactly like a lock that is
 * working, until somebody's paragraph disappears a fortnight later. That is the
 * failure `astrosite/test/unit/biography-lock.test.ts` exists about, and moving
 * the code is when it could quietly stop being true.
 *
 * `biographiesToRegenerate` itself is tested there and is not re-tested here.
 * What is new is everything around it — the upcoming-Hector gate, the reporting,
 * and the refusal to run live without a generator.
 */

const NOW = new Date('2026-09-20T12:00:00Z')

const player = (id: string, fields: Partial<Player> = {}): Player => ({
    id,
    name: { first: id, last: 'Player' },
    contact: { phone: '+358000000000' },
    biography: ['A paragraph.'],
    ...fields,
})

const hector = (id: string, start: string, participants: string[] = ['eero-s']): Event =>
    ({
        id,
        format: EventFormat.Hector,
        name: id,
        location: 'Somewhere',
        timing: { start, end: start },
        participants,
        ignore: false,
        maxStrokesOverPar: 4,
    }) as Event

const deps = (players: Player[], events: Event[], generate?: Parameters<typeof run>[0]['generate']) => ({
    players: async () => players,
    events: async () => events,
    now: () => NOW,
    generate,
})

describe('the upcoming-Hector gate', () => {
    /**
     * Out of season there is no event to write for, and the workflow applies the
     * same gate. A successful no-op rather than a failure, because this is the
     * normal state of this job for most of the year.
     */
    it('does nothing, successfully, when no Hector is upcoming', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2025', '2025-09-25')]), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('No upcoming Hector')
    })

    it('does nothing when the upcoming Hector has no field yet', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2027', '2027-09-24', [])]), true)

        expect(result.detail).toContain('No upcoming Hector')
    })

    it('takes the nearest upcoming Hector when there are two', async () => {
        const result = await run(
            deps(
                [player('eero-s')],
                [hector('HECTOR2028', '2028-09-24'), hector('HECTOR2026', '2026-09-24')]
            ),
            true
        )

        expect(result.detail).toContain('HECTOR2026')
    })

    /** An event starting today still counts, matching the site's `isUpcomingEvent`. */
    it('counts a Hector starting today as upcoming', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTORNOW', '2026-09-20')]), true)

        expect(result.detail).toContain('HECTORNOW')
    })
})

describe('who a run would rewrite', () => {
    it('counts the unlocked, and names the ones a lock is holding', async () => {
        const result = await run(
            deps(
                [player('eero-s'), player('lasse-k', { biographyLocked: true })],
                [hector('HECTOR2026', '2026-09-24')]
            ),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('1 biography to regenerate')
        expect(result.detail).toContain('1 left alone (lasse-k Player)')
    })

    /**
     * A `Change` claims a before and an after. This slice does not generate, so
     * it has no after — and inventing one would put a value in the run log that
     * was never produced.
     */
    it('reports no changes, having generated nothing to report', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')]), true)

        expect(result.changes).toEqual([])
        expect(result.detail).toContain('Nothing was generated')
    })

    it('says so when every biography is locked', async () => {
        const result = await run(
            deps([player('eero-s', { biographyLocked: true })], [hector('HECTOR2026', '2026-09-24')]),
            true
        )

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('0 biographies to regenerate')
    })
})

describe('a live run', () => {
    it('refuses while there is no generator, rather than succeeding at nothing', async () => {
        const result = await run(deps([player('eero-s')], [hector('HECTOR2026', '2026-09-24')]), false)

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('no generator yet')
    })

    /**
     * The generator takes the whole selection rather than one player at a time,
     * because generation is not independent per player: each biography is
     * produced partly from the others in the same run, and from what the locked
     * ones already say.
     */
    it('hands the generator the roster and the already-published phrasing', async () => {
        let handed: { players: string[]; published: string[] } | undefined

        const result = await run(
            deps(
                [player('eero-s'), player('lasse-k', { biographyLocked: true, biography: ['Lasse wrote this.'] })],
                [hector('HECTOR2026', '2026-09-24')],
                async (regenerate, alreadyPublished) => {
                    handed = { players: regenerate.map((p) => p.id), published: [...alreadyPublished] }
                    return { changes: [{ subject: 'eero-s', from: '1 paragraph', to: '3 paragraphs' }], commit: 'abc' }
                }
            ),
            false
        )

        expect(handed).toEqual({ players: ['eero-s'], published: ['Lasse wrote this.'] })
        expect(result.outcome).toBe('ok')
        expect(result.commit).toBe('abc')
    })
})
