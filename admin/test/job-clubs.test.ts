import { describe, expect, it } from 'vitest'

import { NullHandicapSource, type GolfClub, type HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'

import { CLUBS_PATH, clubList, daysSince, fetchedAt, run } from '../src/lib/jobs/clubs.ts'

/**
 * Refreshing the committed club list, at most once a month.
 *
 * The job replaces a write `update-player-biographies.yml` already makes, so
 * what is new is not the fetching but the *not* fetching: a 30-day window, and
 * three ways to decline that all have to leave the committed file alone. This
 * file is the only copy of 140 clubs and nothing reads it yet, so a wrong
 * refusal is invisible and a wrong write is permanent.
 */

const NOW = new Date('2026-09-20T12:00:00Z')
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

const club = (abbreviation: string): GolfClub => ({
    name: `${abbreviation} Golf`,
    abbreviation,
    sources: [],
})

const source = (name: string, clubs: GolfClub[]): HandicapSource =>
    ({ name, getClubs: async () => clubs }) as unknown as HandicapSource

type Committed = { text: string; message: string }

const deps = (file: string | undefined, sources: HandicapSource[], committed: Committed[] = []) => ({
    readFile: async () => file,
    sources: async () => sources,
    now: () => NOW,
    commit: async (text: string, message: string) => {
        committed.push({ text, message })
        return { ok: true as const, commit: 'abc123' }
    },
})

describe('reading the stamp off the committed file', () => {
    it('takes the timestamp the last run wrote', () => {
        expect(fetchedAt(JSON.stringify({ fetchedAt: days(3), clubs: [] }))?.toISOString()).toBe(days(3))
    })

    /**
     * The three shapes that all mean "ask WiseGolf". The bare array is the file
     * as this job inherited it, which makes the first run the migration: no
     * stamp, so it refreshes and writes the new shape.
     */
    it('answers nothing for the bare array it inherited', () => {
        expect(fetchedAt(JSON.stringify([club('TaG')]))).toBeUndefined()
    })

    it('answers nothing for a missing or unparseable file', () => {
        expect(fetchedAt(undefined)).toBeUndefined()
        expect(fetchedAt('{ not json')).toBeUndefined()
        expect(fetchedAt(JSON.stringify({ fetchedAt: 'the other Tuesday', clubs: [] }))).toBeUndefined()
    })
})

describe('the 30-day window', () => {
    it('does not ask WiseGolf about a list fetched yesterday', async () => {
        const committed: Committed[] = []
        const result = await run(
            deps(JSON.stringify({ fetchedAt: days(1), clubs: [club('TaG')] }), [source('WiseGolf', [club('TaG')])], committed),
            false
        )

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('1 day ago')
        expect(committed).toEqual([])
    })

    it('asks once the list is older than the window', async () => {
        const committed: Committed[] = []
        const result = await run(
            deps(JSON.stringify({ fetchedAt: days(31), clubs: [] }), [source('WiseGolf', [club('TaG')])], committed),
            false
        )

        expect(result.outcome).toBe('ok')
        expect(committed).toHaveLength(1)
        expect(JSON.parse(committed[0]!.text)).toEqual({
            fetchedAt: NOW.toISOString(),
            clubs: [club('TaG')],
        })
    })

    it('asks when the file has never carried a stamp, which is the migration', async () => {
        const committed: Committed[] = []
        await run(deps(JSON.stringify([club('TaG')]), [source('WiseGolf', [club('TaG')])], committed), false)

        expect(JSON.parse(committed[0]!.text).fetchedAt).toBe(NOW.toISOString())
    })
})

describe('the three ways it declines to write', () => {
    /**
     * The workflow's guard, kept. No source answering is an outage, not a world
     * with no golf clubs in it — and this file is the only copy, so writing the
     * empty answer would replace 140 clubs with nothing and fail loudly nowhere.
     */
    it('leaves the file alone when no source lists a club', async () => {
        const committed: Committed[] = []
        const result = await run(deps(undefined, [source('WiseGolf', [])], committed), false)

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('left alone')
        expect(committed).toEqual([])
    })

    it('leaves the file alone when the source is disabled for want of credentials', async () => {
        const committed: Committed[] = []
        const result = await run(deps(undefined, [new NullHandicapSource('WiseGolf')], committed), false)

        expect(result.outcome).toBe('skipped')
        expect(result.detail).toContain('No handicap source')
        expect(committed).toEqual([])
    })

    it('writes nothing on a dry run, having asked', async () => {
        const committed: Committed[] = []
        const result = await run(deps(undefined, [source('WiseGolf', [club('TaG')])], committed), true)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toContain('nothing was written')
        expect(committed).toEqual([])
    })

    it('reports a failed commit as failed, not as a refresh', async () => {
        const result = await run(
            {
                ...deps(undefined, [source('WiseGolf', [club('TaG')])]),
                commit: async () => ({ ok: false as const, detail: 'GitHub said no' }),
            },
            false
        )

        expect(result.outcome).toBe('failed')
        expect(result.detail).toBe('GitHub said no')
    })
})

describe('the list it writes', () => {
    it('keeps one entry per abbreviation, sorted', () => {
        expect(clubList([club('TaG'), club('ArGC'), { ...club('TaG'), name: 'Duplicate' }])).toEqual([
            club('ArGC'),
            club('TaG'),
        ])
    })

    it('goes to the path the site keeps it at', () => {
        expect(CLUBS_PATH).toBe('astrosite/src/data/clubs.json')
    })

    it('measures age in whole days', () => {
        expect(daysSince(new Date(days(0.5)), NOW)).toBe(0)
        expect(daysSince(new Date(days(30)), NOW)).toBe(30)
        expect(daysSince(undefined, NOW)).toBeUndefined()
    })
})
