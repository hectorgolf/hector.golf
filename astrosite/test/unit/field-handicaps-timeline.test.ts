import { expect, describe, it, vi, beforeEach } from 'vitest'
import type { HandicapCheck } from '@hector/schemas/src/handicap-checks.ts'

/**
 * The freeze-versus-observation logic, played out over a real Hector's week.
 *
 * HECTOR2025 was played at Empordà on 25-28 September 2025, and its split, its
 * frozen handicaps and its timing are all committed — so the only thing this has to
 * supply is the sweep log, which for that week no longer exists anywhere. GitHub
 * keeps workflow runs for about six months and the data commits only record sweeps
 * that *changed* something: there is a three-day gap over the 2025 freeze, from
 * 2025-09-23T03:25:01Z to 2025-09-26T13:21:21Z, because nobody's handicap moved.
 *
 * Backfilling `handicap-checks.json` with invented instants would put that evidence
 * beyond telling apart from the real thing — the same call `handicaps.json` already
 * makes by leaving `observed` off the entries that predate it. So the sweeps are
 * constructed here instead, where they are visibly a fixture, and the event they are
 * asked about is the real one.
 */

/**
 * A dawn sweep and a midday one, at 03:02 and 12:01. Cloud Scheduler actually
 * fires four times a day — see `data_update_schedules` in terraform/scheduler.tf —
 * but the extra morning ticks would add rows to this log without adding a case to
 * any assertion below, all of which turn on first-morning versus later-day.
 */
const sweeps = (skippedAtDawn: string[] = []): HandicapCheck[] =>
    ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'].flatMap((day) => [
        { at: `2025-09-${day}T03:02:41Z`, checked: 24 - skippedAtDawn.length, skipped: skippedAtDawn },
        { at: `2025-09-${day}T12:01:07Z`, checked: 24, skipped: [] },
    ])

let log: HandicapCheck[] = []
vi.mock('../../src/code/handicap-checks', () => ({ getHandicapChecks: () => log }))

const payload = async () => {
    const { fieldHandicaps } = await import('../../src/code/field-handicaps')
    const { getEventById } = await import('../../src/code/events')
    return fieldHandicaps(getEventById('HECTOR2025') as any)
}

const playerIn = (p: Awaited<ReturnType<typeof payload>>, id: string) => p.handicaps.find((x) => x.id === id)!

describe('HECTOR2025, swept twice a day through its week', () => {
    beforeEach(() => {
        log = sweeps()
    })

    it('freezes its buckets at 08:00 in Spain on the first morning', async () => {
        // CEST in September, so 06:00Z. Everything below hangs off this instant.
        expect((await payload()).bucket_freeze).toBe('2025-09-25T06:00:00Z')
    })

    it('dates the bucketing handicap from the last sweep before that', async () => {
        // 03:02 on the 25th, not the 12:01 later that same day — the split had
        // already settled by then, so that sweep cannot be what drew it.
        const p = await payload()
        for (const player of p.handicaps) {
            expect(player.bucketing.observed, player.id).toBe('2025-09-25T03:02:41Z')
        }
    })

    it("dates the playing handicap from the last sweep of the event's final day", async () => {
        const p = await payload()
        for (const player of p.handicaps) {
            expect(player.playing.observed, player.id).toBe('2025-09-28T12:01:07Z')
        }
    })

    it('keeps the two apart, which is the whole point of publishing both', async () => {
        const p = await payload()
        const tommy = playerIn(p, 'tommy-g')
        expect(tommy.bucketing.observed).not.toBe(tommy.playing.observed)
        // And the handicaps themselves moved over the week, in the committed data.
        expect(tommy.bucketing.hcp).not.toBe(tommy.playing.hcp)
    })

    it('ignores sweeps that ran after the event, however many there are', async () => {
        log = [...sweeps(), { at: '2026-09-14T08:05:00Z', checked: 45, skipped: [] }]
        const p = await payload()
        expect(p.handicaps_checked).toBe('2025-09-28T12:01:07Z')
        expect(playerIn(p, 'tommy-g').playing.observed).toBe('2025-09-28T12:01:07Z')
    })

    describe('when a sweep skips somebody', () => {
        it('falls back to the last sweep that did answer for them', async () => {
            // Skipped at dawn every day, so the freeze at 06:00 on the 25th is
            // explained by the 12:01 sweep of the 24th for him and the 03:02 sweep of
            // the 25th for everybody else.
            log = sweeps(['tommy-g'])
            const p = await payload()
            expect(playerIn(p, 'tommy-g').bucketing.observed).toBe('2025-09-24T12:01:07Z')
            expect(playerIn(p, 'jari-k').bucketing.observed).toBe('2025-09-25T03:02:41Z')
        })

        it('drags the whole field down to what it can actually guarantee', async () => {
            // `handicaps_checked` is the oldest playing stamp in the field, so one
            // player missed by the final sweep makes the file report the freshness it
            // really has rather than the one the latest sweep would suggest.
            log = sweeps().filter((s) => s.at !== '2025-09-28T12:01:07Z')
            log = log.map((s) => (s.at === '2025-09-28T03:02:41Z' ? { ...s, skipped: ['tommy-g'], checked: 23 } : s))
            const p = await payload()
            expect(playerIn(p, 'tommy-g').playing.observed).toBe('2025-09-27T12:01:07Z')
            expect(playerIn(p, 'jari-k').playing.observed).toBe('2025-09-28T03:02:41Z')
            expect(p.handicaps_checked).toBe('2025-09-27T12:01:07Z')
        })

        it('makes no guarantee at all when somebody has never been checked', async () => {
            log = sweeps().map((s) => ({ ...s, skipped: ['tommy-g'], checked: 23 }))
            const p = await payload()
            expect(playerIn(p, 'tommy-g').playing.observed).toBeNull()
            expect(p.handicaps_checked).toBeNull()
        })
    })
})
