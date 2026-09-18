import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type HandicapHistoryEntry, latestPerDay } from '@hector/schemas/src/handicaps.ts'

import { documentId, parse, render } from '../src/lib/handicaps/observations.ts'

/**
 * The replay: the committed history, through the new storage, and back out.
 *
 * This is the part of `docs/plans/handicaps-to-firestore.md` that does not have
 * to wait for the season. The migration's two riskiest assumptions — that an
 * entry can be given a stable document id, and that the rendered backup is the
 * same data as the file it replaces — are both decidable offline against the
 * 1,406 entries already in git, and both are asserted here rather than hoped for
 * during a week of dual-running that ends when the golf does.
 */

const committed: HandicapHistoryEntry[] = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../astrosite/src/data/handicaps.json'), 'utf-8')
)

describe('the document id', () => {
    it('is unique across every entry ever committed', () => {
        // The assumption the whole reconcile rests on. If two entries share an
        // id, the second silently overwrites the first on the way in and the
        // history is quietly shorter than it was.
        const ids = committed.map(documentId)
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
        expect(duplicates).toEqual([])
        expect(new Set(ids).size).toBe(committed.length)
    })

    it('keys the entries that predate `observed` as unstamped', () => {
        const unstamped = committed.filter((entry) => entry.observed === undefined)
        // Not an incidental property: it is what makes the key safe. Every
        // unstamped entry was written while the old writer still de-duplicated
        // per day, so `(player, date)` is unique among them by construction.
        expect(unstamped.length).toBeGreaterThan(0)
        const keys = unstamped.map((entry) => `${entry.player}_${entry.date}`)
        expect(new Set(keys).size).toBe(unstamped.length)
        expect(documentId(unstamped[0]!)).toMatch(/_unstamped$/)
    })

    it('distinguishes two readings of the same player on the same day', () => {
        const morning: HandicapHistoryEntry = {
            player: 'lasse-k',
            date: '2026-09-14',
            handicap: 14.7,
            observed: '2026-09-14T03:02:42Z',
        }
        const afternoon = { ...morning, handicap: 14.5, observed: '2026-09-14T13:41:09Z' }
        expect(documentId(morning)).not.toBe(documentId(afternoon))
    })
})

describe('rendering the backup', () => {
    it('round-trips every committed entry without losing or inventing one', () => {
        const back = parse(render(committed))
        expect(back.length).toBe(committed.length)
        // Compared as sets keyed by id, because `render` sorts and the committed
        // file is in whatever order it grew in.
        expect(new Set(back.map(documentId))).toEqual(new Set(committed.map(documentId)))
    })

    it('preserves the daily view the site actually reads', () => {
        // The acceptance criterion from the plan, asserted against the data that
        // exists rather than the data next week will.
        //
        // Compared as a map rather than as two arrays, deliberately. What the
        // site reads is "this player's handicap on this day", and asserting on
        // the array would additionally pin the order `latestPerDay` happens to
        // return — which, for the same tie in `compareObservations` that
        // `compareForRendering` exists to break, is a property of the input
        // order rather than of the data.
        const daily = (entries: HandicapHistoryEntry[]) =>
            new Map(latestPerDay(entries).map((entry) => [`${entry.player} ${entry.date}`, entry.handicap]))
        expect(daily(parse(render(committed)))).toEqual(daily(committed))
    })

    /**
     * The one clause of the plan's acceptance criterion that the data in git
     * cannot demonstrate, because the shape only exists once both pipelines are
     * writing.
     *
     * Step 2 made a handicap change produce *two* observations rather than one:
     * the job stamps `observed` when it scrapes, and the workflow stamps a later
     * one when it commits, so the reconcile brings both in. Same player, same
     * day, same value, seconds apart. That is the "second reading" the criterion
     * says every extra row has to be explainable as — just not the explanation
     * the plan first had in mind, which was the Union publishing twice.
     *
     * Asserted here rather than watched for, because waiting to see it live means
     * waiting for a handicap to move, and they stop moving for the season in
     * October. The existing two-readings test above covers the ids; this covers
     * what a reader of the two stores would actually compare.
     */
    it('keeps both of a dual-run day and still agrees on the daily view', () => {
        const legacy: HandicapHistoryEntry[] = [
            ...committed,
            // What `update-handicaps.yml` commits: stamped when it committed.
            { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T05:01:06Z' },
        ]
        const backup: HandicapHistoryEntry[] = [
            ...legacy,
            // What the job wrote for itself, half a minute earlier, having read
            // the same pre-change file and reached the same answer.
            { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T05:00:35Z' },
        ]

        const rendered = parse(render(backup))

        // The drift, stated as a number so that nobody reading a row count later
        // mistakes it for a bug: one row ahead per change, permanently.
        expect(rendered.length).toBe(legacy.length + 1)

        // And the thing that makes the drift harmless: the site reads days, not
        // readings, and both stores answer every day identically.
        const daily = (entries: HandicapHistoryEntry[]) =>
            new Map(latestPerDay(entries).map((entry) => [`${entry.player} ${entry.date}`, entry.handicap]))
        expect(daily(rendered)).toEqual(daily(legacy))

        // Superset, the criterion's second clause: nothing the old pipeline
        // committed is missing from the backup.
        const ids = new Set(rendered.map(documentId))
        expect(legacy.every((entry) => ids.has(documentId(entry)))).toBe(true)
    })

    /**
     * The same day with two *different* values, which is the case the criterion
     * was originally written for and which the dual-run does not produce.
     *
     * Worth keeping next to the one above, because it is the only one of the two
     * that can observe `latestPerDay` sorting on `observed`. With the equal
     * values a dual-run produces, picking either row gives the same answer, so
     * that test would pass against a `latestPerDay` that returned whichever row
     * it happened to see first.
     *
     * Fed the entries directly and deliberately out of order, *not* through
     * `render`. Going through the render sorts them on the way past, which hides
     * exactly the behaviour being asserted — the first version of this test did
     * that and went on passing with `latestPerDay`'s own sort deleted.
     */
    it('takes the later reading when a day holds two different values', () => {
        const history: HandicapHistoryEntry[] = [
            { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T13:41:09Z' },
            { player: 'sami-h', date: '2026-09-18', handicap: 4.8, observed: '2026-09-18T05:00:35Z' },
        ]
        const daily = latestPerDay(history)
        expect(daily).toHaveLength(1)
        expect(daily[0]!.handicap).toBe(5.2)
    })

    it('is stable: rendering twice produces the same bytes', () => {
        // Phantom diffs are the failure this prevents. An unstable render commits
        // a whole-file change on every tick, and the append-only guard refuses
        // every one of them.
        expect(render(committed)).toBe(render([...committed].reverse()))
    })

    it('writes one object per line, with a trailing newline', () => {
        const ndjson = render(committed.slice(0, 3))
        expect(ndjson.endsWith('\n')).toBe(true)
        expect(ndjson.trimEnd().split('\n')).toHaveLength(3)
    })

    it('omits `observed` rather than writing it as null', () => {
        const ndjson = render([{ player: 'lasse-k', date: '2024-05-19', handicap: 14.7 }])
        expect(ndjson).toBe('{"date":"2024-05-19","player":"lasse-k","handicap":14.7}\n')
    })

    it('fixes the key order, so a refactor cannot rewrite every line', () => {
        const entry: HandicapHistoryEntry = {
            observed: '2026-09-14T05:22:46Z',
            handicap: 9.4,
            player: 'jussi-a',
            date: '2026-09-14',
        }
        expect(render([entry])).toBe(
            '{"date":"2026-09-14","player":"jussi-a","handicap":9.4,"observed":"2026-09-14T05:22:46Z"}\n'
        )
    })

    it('renders nothing for an empty history, rather than a blank line', () => {
        expect(render([])).toBe('')
    })
})
