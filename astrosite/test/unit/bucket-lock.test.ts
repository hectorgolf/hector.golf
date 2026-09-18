import { expect, describe, it } from 'vitest'
import { bucketsToRecompute } from '../../src/workflows/update-handicaps'
import { bucketsAreOpen, bucketsFreezeAt } from '../../src/code/data'
import { fieldHandicaps } from '../../src/code/field-handicaps'
import { getEventById } from '../../src/code/events'
import { hectorEventSchema, type HectorEvent } from '@hector/schemas/src/events.ts'

/**
 * `event.bucketsLocked` settles a split *before* the clock would.
 *
 * `bucketsAreOpen` already stops the recompute at 08:00 on the first morning, which
 * covers the case the Draft cares about. What it cannot express is the days before:
 * a split gets announced — in a message, in a group chat, at the previous round —
 * and from that moment a scrape that reshuffles the halves puts the page at odds
 * with what the players were told. The lock is how somebody says "this one is
 * settled now", and there is no date that says it for them.
 *
 * It is deliberately *not* folded into `bucketsAreOpen`, which answers a question
 * about the clock and is published as the instant `bucket_freeze`. A lock is a
 * decision, not a time; expressing it as one would mean publishing a freeze at an
 * hour that never happened.
 */

const hectorAt = (over: Record<string, unknown> = {}): HectorEvent =>
    hectorEventSchema.parse({
        id: 'TEST',
        format: 'hector',
        name: 'Test Hector',
        location: 'Somewhere',
        maxStrokesOverPar: 4,
        participants: ['adam', 'ben', 'charlie', 'david'],
        timing: { start: '2026-09-24', end: '2026-09-27', timezone: 'Europe/Prague' },
        ...over,
    })

/** Well before the 2026 freeze, which is 08:00 at Konopiště and so 06:00Z. */
const wellBefore = new Date('2026-09-17T06:00:00Z')

describe('bucketsLocked, as a field', () => {
    it('is a boolean', () => {
        expect(hectorEventSchema.safeParse({ ...hectorAt(), bucketsLocked: true }).success).toBe(true)
        expect(hectorEventSchema.safeParse({ ...hectorAt(), bucketsLocked: 'yes' }).success).toBe(false)
    })

    it('is optional, and stays absent when it is not set', () => {
        // Undefaulted on purpose. Firestore stores what Zod produced, so a
        // `.default(false)` would write `"bucketsLocked": false` into all thirteen
        // Hector files the first time one round-trips through an export — thirteen
        // lines saying nothing their absence did not already say.
        const parsed = hectorEventSchema.parse(hectorAt())
        expect(parsed.bucketsLocked).toBeUndefined()
        expect(Object.keys(parsed)).not.toContain('bucketsLocked')
    })
})

describe('bucketsToRecompute()', () => {
    it('redraws a split that is open and unlocked', () => {
        const { recompute, locked } = bucketsToRecompute([hectorAt()], wellBefore)
        expect(recompute.map((e) => e.id)).toEqual(['TEST'])
        expect(locked).toEqual([])
    })

    it('leaves a locked split alone, and says which one it left', () => {
        // Named rather than merely dropped: the caller logs the events in this list,
        // because a lock that stops a recompute silently is a suspected bug the first
        // time somebody wonders why the buckets did not move.
        const { recompute, locked } = bucketsToRecompute([hectorAt({ bucketsLocked: true })], wellBefore)
        expect(recompute).toEqual([])
        expect(locked.map((e) => e.id)).toEqual(['TEST'])
    })

    it('reads an explicit false as no lock at all', () => {
        const { recompute } = bucketsToRecompute([hectorAt({ bucketsLocked: false })], wellBefore)
        expect(recompute.map((e) => e.id)).toEqual(['TEST'])
    })

    it('does not call a split locked once the clock has settled it anyway', () => {
        // After the freeze there is nothing for the lock to stop, so the event is in
        // neither list and nothing is logged about it. Otherwise every locked Hector
        // on record would announce itself on every tick, forever.
        const afterTheFreeze = new Date('2026-09-24T06:00:00Z')
        const { recompute, locked } = bucketsToRecompute([hectorAt({ bucketsLocked: true })], afterTheFreeze)
        expect(recompute).toEqual([])
        expect(locked).toEqual([])
    })

    it('still skips an event with no participants, locked or not', () => {
        const empty = [hectorAt({ participants: [] }), hectorAt({ id: 'TEST2', participants: [], bucketsLocked: true })]
        const { recompute, locked } = bucketsToRecompute(empty, wellBefore)
        expect(recompute).toEqual([])
        expect(locked).toEqual([])
    })

    it('leaves the clock rule alone', () => {
        // The two predicates stay separate. `field-handicaps.test.ts` asserts that
        // `bucket_freeze` and `bucketsAreOpen` agree, and they can only keep agreeing
        // while neither of them knows about the lock.
        const locked = hectorAt({ bucketsLocked: true })
        expect(bucketsAreOpen(locked, wellBefore)).toBe(true)
        expect(bucketsFreezeAt(locked)!.toUTC().toISO({ suppressMilliseconds: true })).toBe('2026-09-24T06:00:00Z')
    })
})

/**
 * Phase 3, and the part that is easy to miss: `bucket_freeze` was the only thing in
 * `/events/hector/<id>/handicaps.json` that answered "is this split final?", and the
 * moment a lock can settle a split before that instant it stops answering it. A
 * consumer reading the instant alone would get "provisional" about a split nobody
 * intends to touch again.
 */
describe('a locked split, as published', () => {
    const hector2026 = () => getEventById('HECTOR2026') as HectorEvent
    const locked = () => ({ ...hector2026(), bucketsLocked: true })

    it('says so in the payload', () => {
        expect(fieldHandicaps(locked(), wellBefore).buckets_locked).toBe(true)
    })

    it('says so of every event, so the key is never missing', () => {
        const payload = fieldHandicaps(hector2026(), wellBefore)
        expect(payload.buckets_locked).toBe(false)
        expect(Object.keys(payload)).toContain('buckets_locked')
    })

    it('does not move the freeze it is published beside', () => {
        // The instant is still the clock's answer. The lock is the other half of the
        // question, which is why both are published rather than one standing in for
        // the other.
        expect(fieldHandicaps(locked(), wellBefore).bucket_freeze).toBe('2026-09-24T06:00:00Z')
    })

    it('stops the bucketing basis at the lock rather than at the freeze', () => {
        // The split stopped moving when it was locked. That moment is not recorded,
        // so the honest upper bound is the build itself — and the sweep cited as what
        // the split was drawn on has to be one that had already happened. Unlocked,
        // the basis runs to the freeze and cites the newest sweep in the log.
        const open = fieldHandicaps(hector2026(), wellBefore).handicaps.find((p) => p.id === 'lasse-k')!
        const shut = fieldHandicaps(locked(), wellBefore).handicaps.find((p) => p.id === 'lasse-k')!

        /*
         * Asserted as a relationship rather than as two literals, and the reason is
         * worth stating because the literals read as more precise.
         *
         * `bucketing.observed` is a sweep's `at` out of `handicap-checks.json`, and
         * that file gains an entry on *every* run of `update-handicaps.yml` whether
         * a handicap moved or not — four scheduled runs a day, plus any pressed by
         * hand. So the unlocked basis, which cites the newest sweep there is, has a
         * new value several times a day. Pinning it made this a test that failed on
         * a timer: it was written against the 05:01 sweep and was already wrong by
         * the 08:03 one, on the same morning, without a line of source changing.
         *
         * What the test is actually about survives the change intact. Locked, the
         * basis stops at a sweep that had already happened when the split was
         * settled; unlocked, it runs on to a later one. That ordering is the whole
         * behaviour, and it does not care which sweeps they are.
         */
        expect(shut.bucketing.observed).not.toBeNull()
        expect(open.bucketing.observed).not.toBeNull()

        // Locked: bounded by the moment the split was settled.
        expect(shut.bucketing.observed! <= wellBefore.toISOString()).toBe(true)

        // Unlocked: strictly later, which is the difference the lock makes.
        expect(open.bucketing.observed! > shut.bucketing.observed!).toBe(true)
    })

    it('leaves the handicaps beside the names alone', () => {
        // Deliberate asymmetry: the split is what was announced, the numbers are
        // information about the players, and a locked split showing yesterday's
        // handicaps would be a second, staler copy of something the site already
        // publishes correctly.
        const open = fieldHandicaps(hector2026(), wellBefore)
        const shut = fieldHandicaps(locked(), wellBefore)
        expect(shut.handicaps.map((p) => [p.id, p.playing.hcp])).toEqual(
            open.handicaps.map((p) => [p.id, p.playing.hcp]),
        )
        expect(shut.handicaps.map((p) => [p.id, p.bucketing.bucket, p.bucketing.hcp])).toEqual(
            open.handicaps.map((p) => [p.id, p.bucketing.bucket, p.bucketing.hcp]),
        )
    })

    it('changes nothing once the freeze has passed anyway', () => {
        const afterwards = new Date('2026-09-30T12:00:00Z')
        const open = fieldHandicaps(hector2026(), afterwards)
        const shut = fieldHandicaps(locked(), afterwards)
        expect({ ...shut, buckets_locked: false }).toEqual(open)
    })
})
