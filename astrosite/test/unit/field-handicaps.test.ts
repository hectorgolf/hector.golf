import { expect, describe, it } from 'vitest'
import { fieldHandicaps } from '../../src/code/field-handicaps'
import { getEventById } from '../../src/code/events'
import { hectorEvents, bucketsAreOpen } from '../../src/code/data'
import { getPlayerById, getPlayerHandicapHistoryById } from '../../src/code/players'
import type { HectorEvent } from '@hector/schemas/src/events.ts'
import { isValidIsoInstant } from '@hector/schemas/src/dates.ts'

/**
 * The payload published at `/events/hector/<id>/handicaps.json`, which
 * app.hector.golf reads to get a Hector's field, its split, and the two handicaps
 * an event gives a player: the one the split was drawn on, frozen at 08:00 on the
 * first morning, and the one they play off, frozen when the event ends. Asserted
 * against the committed data rather than a fixture, because what a consumer
 * actually depends on is the shape of the real file.
 */

const eventById = (id: string): HectorEvent => {
    const event = getEventById(id) as HectorEvent | undefined
    if (!event) throw new Error(`No event ${id} in the committed data`)
    return event
}

/** Konopiště, 24-27 September 2026: the next Hector, with a split still open. */
const hector2026 = () => eventById('HECTOR2026')

/** 2014, long finished and predating both buckets and the handicap log. */
const hector2014 = () => eventById('HECTOR2014')

/** Before the first tee of 2026, and long before its bucket freeze. */
const wellBefore = new Date('2026-09-14T06:28:50Z')

describe('fieldHandicaps()', () => {
    it('names the event it is about', () => {
        expect(fieldHandicaps(hector2026()).event).toBe('HECTOR2026')
    })

    it('stamps the moment it was generated, to the second', () => {
        const payload = fieldHandicaps(hector2026(), new Date('2026-09-14T06:28:50.123Z'))
        expect(payload.generatedAt).toBe('2026-09-14T06:28:50Z')
        expect(isValidIsoInstant(payload.generatedAt)).toBe(true)
    })

    describe('bucket_freeze', () => {
        it('is 08:00 where the event is played, as an instant', () => {
            // Konopiště is CEST in September, so 08:00 local is 06:00Z.
            expect(fieldHandicaps(hector2026()).bucket_freeze).toBe('2026-09-24T06:00:00Z')
            expect(isValidIsoInstant(fieldHandicaps(hector2026()).bucket_freeze!)).toBe(true)
        })

        it('is the same rule the site freezes buckets by', () => {
            // Published so a consumer can compare it against `generatedAt` instead of
            // reimplementing `bucketsAreOpen`. The two must not be able to drift.
            for (const id of ['HECTOR2026', 'HECTOR2025', 'HECTOR2024', 'HECTOR2014']) {
                const event = eventById(id)
                const freeze = new Date(fieldHandicaps(event).bucket_freeze!)
                expect(bucketsAreOpen(event, new Date(freeze.getTime() - 1000)), id).toBe(true)
                expect(bucketsAreOpen(event, freeze), id).toBe(false)
            }
        })
    })

    describe('the field', () => {
        it('holds every participant, once', () => {
            const event = hector2026()
            const ids = fieldHandicaps(event).handicaps.map((p) => p.id)
            expect(ids.slice().sort()).toEqual(event.participants.slice().sort())
        })

        it('gives every entry the same keys, whatever is known about the player', () => {
            const keys = ['id', 'name', 'bucketing', 'playing']
            for (const event of [hector2026(), hector2014()]) {
                for (const entry of fieldHandicaps(event).handicaps) {
                    expect(Object.keys(entry), `${event.id}/${entry.id}`).toEqual(keys)
                    expect(Object.keys(entry.bucketing), `${event.id}/${entry.id}`).toEqual([
                        'bucket',
                        'hcp',
                        'observed',
                    ])
                    expect(Object.keys(entry.playing), `${event.id}/${entry.id}`).toEqual(['hcp', 'observed'])
                }
            }
        })

        it('renders names the way the site renders them', () => {
            for (const player of fieldHandicaps(hector2026()).handicaps) {
                expect(player.name).not.toBe('Unknown player')
                expect(player.name.length).toBeGreaterThan(0)
            }
        })

        it('is ordered lowest playing handicap first', () => {
            const handicaps = fieldHandicaps(hector2026())
                .handicaps.map((p) => p.playing.hcp)
                .filter((h): h is number => h !== null)
            expect(handicaps).toEqual(handicaps.slice().sort((a, b) => a - b))
        })

        it('stamps both handicaps with a moment, not a day', () => {
            // The point of the timestamps is explaining a player whose eBirdie shows
            // something else: the gap is timing, and a date alone cannot show it.
            for (const id of ['HECTOR2026', 'HECTOR2025', 'HECTOR2024', 'HECTOR2014']) {
                for (const player of fieldHandicaps(eventById(id)).handicaps) {
                    for (const stamp of [player.bucketing.observed, player.playing.observed]) {
                        if (stamp !== null) expect(isValidIsoInstant(stamp), `${player.id} in ${id}`).toBe(true)
                    }
                }
            }
        })

        it('never cites a sweep from after the handicap it stamps was settled', () => {
            for (const id of ['HECTOR2026', 'HECTOR2025', 'HECTOR2024', 'HECTOR2014']) {
                const event = eventById(id)
                const payload = fieldHandicaps(event)
                for (const player of payload.handicaps) {
                    if (player.bucketing.observed !== null) {
                        expect(player.bucketing.observed <= payload.bucket_freeze!, `${player.id} in ${id}`).toBe(
                            true,
                        )
                    }
                    if (player.playing.observed !== null) {
                        const day = player.playing.observed.slice(0, 10)
                        expect(day <= event.timing.end, `${player.id} in ${id}`).toBe(true)
                    }
                }
            }
        })

        it('stamps the playing handicap no earlier than the bucketing one', () => {
            // The two are the same question asked at the two ends of an event, so the
            // later end cannot cite an earlier sweep.
            for (const id of ['HECTOR2026', 'HECTOR2025', 'HECTOR2024']) {
                for (const player of fieldHandicaps(eventById(id)).handicaps) {
                    if (player.bucketing.observed !== null && player.playing.observed !== null) {
                        expect(player.playing.observed >= player.bucketing.observed, player.id).toBe(true)
                    }
                }
            }
        })
    })

    describe('the split', () => {
        it('numbers the buckets from one, as the committed file draws them', () => {
            const committed = hectorEvents.find((e) => e.id === 'HECTOR2026')!
            const byId = new Map(fieldHandicaps(hector2026()).handicaps.map((p) => [p.id, p]))
            expect(committed.buckets!.length).toBe(2)
            committed.buckets!.forEach((bucket, index) => {
                for (const player of bucket) {
                    expect(byId.get(player.id)!.bucketing.bucket, player.id).toBe(index + 1)
                }
            })
        })

        it('is null for a player in an event with no split', () => {
            expect(fieldHandicaps(hector2014()).handicaps.every((p) => p.bucketing.bucket === null)).toBe(true)
        })
    })

    describe('the bucketing handicap', () => {
        it('is the number frozen into the committed event file', () => {
            const committed = hectorEvents.find((e) => e.id === 'HECTOR2026')!
            const byId = new Map(fieldHandicaps(hector2026()).handicaps.map((p) => [p.id, p]))
            const bucketed = committed.buckets!.flat()
            expect(bucketed.length).toBeGreaterThan(0)
            for (const player of bucketed) {
                expect(byId.get(player.id)!.bucketing.hcp).toBe(player.handicap)
            }
        })

        it('ignores the handicaps on the event handed in', () => {
            // `populateUpdatedHandicaps` replaces exactly these numbers with current
            // ones for any event that is not yet past — which includes every event
            // between its bucket freeze and its last day, the window in which the two
            // handicaps differ and the only one in which this file is polled. Reading
            // them from the enriched event would publish the playing handicap twice.
            const event = hector2026()
            const committed = hectorEvents.find((e) => e.id === event.id)!
            const victim = event.buckets![0][0]
            victim.handicap = 99.9
            const published = fieldHandicaps(event).handicaps.find((p) => p.id === victim.id)!
            expect(published.bucketing.hcp).toBe(committed.buckets![0][0].handicap)
            expect(published.bucketing.hcp).not.toBe(99.9)
        })

        it('stops moving on the first morning, while the playing handicap does not', () => {
            const event = hector2026()
            const mid = fieldHandicaps(event, new Date('2026-09-26T10:00:00Z'))
            const before = fieldHandicaps(event, wellBefore)
            // Read as of the 24th on both counts, so mid-event and a week out agree.
            expect(mid.handicaps.map((p) => p.bucketing.hcp)).toEqual(before.handicaps.map((p) => p.bucketing.hcp))
        })

        it('falls back to the log for an event with no split', () => {
            // 2014 predates the log as well as the buckets, so the fallback has
            // nothing to offer and says so rather than reaching forward.
            const payload = fieldHandicaps(hector2014())
            expect(payload.handicaps.length).toBeGreaterThan(0)
            expect(payload.handicaps.every((p) => p.bucketing.hcp === null)).toBe(true)
        })
    })

    describe('the playing handicap', () => {
        it('is what the rest of the site reports while the event is live', () => {
            for (const player of fieldHandicaps(hector2026()).handicaps) {
                expect(player.playing.hcp).toBe(getPlayerById(player.id)?.handicap ?? null)
            }
        })

        it('is the handicap a past event was actually played off', () => {
            const event = eventById('HECTOR2024')
            const played = fieldHandicaps(event).handicaps.filter((p) => p.playing.hcp !== null)
            expect(played.length).toBeGreaterThan(0)
            for (const player of played) {
                const atTheTime = getPlayerHandicapHistoryById(player.id)
                    .filter((entry) => entry.date <= event.timing.end)
                    .at(-1)
                expect(player.playing.hcp).toBe(atTheTime?.handicap)
            }
        })

        it('diverges from the bucketing handicap over an event that has been played', () => {
            // Rounds count, so handicaps move between the first morning and the last
            // day. An event where the two never differ would mean one of them is not
            // being read as of what it claims.
            const payload = fieldHandicaps(eventById('HECTOR2024'))
            const moved = payload.handicaps.filter((p) => p.bucketing.hcp !== p.playing.hcp)
            expect(moved.length).toBeGreaterThan(0)
        })

        it('publishes no handicap at all where the log does not reach back', () => {
            // The log starts in May 2024. Nothing can be said about the handicaps
            // played off in 2014, and saying today's instead would be a lie about an
            // archived field rather than a gap in it.
            const payload = fieldHandicaps(hector2014())
            expect(payload.handicaps.every((p) => p.playing.hcp === null)).toBe(true)
        })
    })
})

/**
 * `bucketing.observed`, `playing.observed` and `handicaps_checked` all come from the
 * sweep log, which records that we looked whether or not anything had moved.
 *
 * What is asserted here is the shape and the cutoffs against the committed log,
 * which only reaches back to the day the log was introduced — so every event before
 * that publishes nulls, and will for good. `handicap-checks.test.ts` carries the
 * selection rules themselves, against sweeps it can construct freely.
 */
describe('when the handicaps were last checked', () => {
    it('is never a sweep that ran after the split froze', () => {
        // A sweep that ran after the split settled cannot be what the split was drawn
        // from, and citing it would be evidence of the opposite of what the timestamp
        // is published to say.
        const payload = fieldHandicaps(eventById('HECTOR2026'))
        const freeze = payload.bucket_freeze!
        for (const player of payload.handicaps) {
            if (player.bucketing.observed !== null) {
                expect(player.bucketing.observed <= freeze, `${player.id}`).toBe(true)
            }
        }
    })

    it('is published for the whole field as well as per player', () => {
        const payload = fieldHandicaps(eventById('HECTOR2026'))
        expect(payload).toHaveProperty('handicaps_checked')
        if (payload.handicaps_checked !== null) {
            expect(isValidIsoInstant(payload.handicaps_checked)).toBe(true)
        }
    })

    it('is the oldest stamp in the field, so it is a guarantee about all of them', () => {
        // Every handicap in the file was checked at least this recently. Taken from
        // the entries rather than from the log, so it cannot claim a freshness that
        // no player in this field actually has — which the latest sweep could, since
        // a sweep is field-wide and may have skipped somebody in this one.
        for (const id of ['HECTOR2026', 'HECTOR2025', 'HECTOR2024', 'HECTOR2014']) {
            const payload = fieldHandicaps(eventById(id))
            const stamps = payload.handicaps.map((p) => p.playing.observed)
            const expected = stamps.some((s) => s === null) ? null : stamps.slice().sort()[0]
            expect(payload.handicaps_checked, id).toBe(expected ?? null)
            for (const stamp of stamps) {
                if (payload.handicaps_checked !== null) {
                    expect(stamp! >= payload.handicaps_checked, `${id}/${stamp}`).toBe(true)
                }
            }
        }
    })

    it('is null throughout for an event older than the sweep log', () => {
        const payload = fieldHandicaps(eventById('HECTOR2014'))
        expect(payload.handicaps_checked).toBeNull()
        expect(payload.handicaps.every((p) => p.bucketing.observed === null)).toBe(true)
    })

    it('does not claim a sweep that postdates a finished event', () => {
        // Sweeps carry on twice a day for years after an event is over. The one that
        // stood while it was played is the last one before its final day.
        const event = eventById('HECTOR2024')
        const payload = fieldHandicaps(event)
        if (payload.handicaps_checked !== null) {
            expect(payload.handicaps_checked.slice(0, 10) <= event.timing.end).toBe(true)
        }
    })
})

/**
 * A Hector's split is part of its record, not a view of current data. Ten years
 * later the 2025 buckets still say who played whom off what, and nothing that has
 * happened to anybody's handicap since is allowed to move them.
 *
 * Everything the payload says about a finished event therefore has to come from
 * something that is itself kept for good: the buckets and the handicaps they were
 * drawn on from the event file, the playing handicaps from the observation log, the
 * timestamps from the sweep log. All three are append-only.
 */
describe('a finished event, a decade later', () => {
    const aDecadeOn = new Date('2035-09-14T06:00:00Z')

    it('publishes the same split as it does today', () => {
        const event = eventById('HECTOR2025')
        const now = fieldHandicaps(event)
        const later = fieldHandicaps(event, aDecadeOn)
        expect(later.handicaps.map((p) => [p.id, p.bucketing.bucket])).toEqual(now.handicaps.map((p) => [p.id, p.bucketing.bucket]))
    })

    it('publishes the same handicaps as it does today', () => {
        const event = eventById('HECTOR2025')
        const now = fieldHandicaps(event)
        const later = fieldHandicaps(event, aDecadeOn)
        expect(later.handicaps).toEqual(now.handicaps)
        expect(later.bucket_freeze).toBe(now.bucket_freeze)
        expect(later.handicaps_checked).toBe(now.handicaps_checked)
    })

    it('draws the split from the committed event file, which is never pruned', () => {
        const committed = hectorEvents.find((e) => e.id === 'HECTOR2025')!
        const byId = new Map(fieldHandicaps(eventById('HECTOR2025'), aDecadeOn).handicaps.map((p) => [p.id, p]))
        committed.buckets!.forEach((bucket, index) => {
            for (const player of bucket) {
                expect(byId.get(player.id)!.bucketing.bucket, player.id).toBe(index + 1)
                expect(byId.get(player.id)!.bucketing.hcp, player.id).toBe(player.handicap)
            }
        })
    })
})
