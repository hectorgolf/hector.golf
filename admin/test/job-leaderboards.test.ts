import { describe, expect, it, vi } from 'vitest'

import { serializeJson } from '@hector/schemas/src/json.ts'
import type { LeaderboardData } from '@hector/schemas/src/leaderboards/app-payload.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { EVENTS_PATH } from '../src/lib/jobs/hector-events.ts'
import {
    LEADERBOARDS_PATH,
    eventsToUpdate,
    isBeingPlayed,
    pairingsFrom,
    playerIdByName,
    run,
    type LeaderboardDependencies,
} from '../src/lib/jobs/leaderboards.ts'

/**
 * What a run decides, without standing in for app.hector.golf or GitHub.
 *
 * The mapping from a tournament payload to a board is `@hector/schemas` and is
 * tested there. What is tested here is everything this job adds: which events it
 * takes, when it declines to commit, what it refuses, and what it says about a
 * source it could not read — the last being the answer app.hector.golf gets back
 * when it pushes.
 */

const APP = 'https://app.hector.golf/api/tournament?event=HECTOR2026'
const SHEET = 'https://docs.google.com/spreadsheets/d/1QBmokR7/edit'

const eventPath = `${EVENTS_PATH}/HECTOR2026.json`
const boardPath = `${LEADERBOARDS_PATH}/HECTOR2026.json`

/** The instant every run below is given: the second day of the 2026 Hector. */
const duringTheEvent = new Date('2026-09-25T11:04:12.000Z')

const eventJson = (over: Record<string, unknown> = {}) => ({
    id: 'HECTOR2026',
    name: 'Hector Trophée 2026',
    location: 'Konopiště',
    maxStrokesOverPar: 4,
    format: 'hector',
    timing: { start: '2026-09-24', end: '2026-09-27', timezone: 'Europe/Prague' },
    participants: ['lasse', 'jari'],
    leaderboardSheet: APP,
    ...over,
})

const player = (id: string, first: string, last: string, aliases?: Array<{ first: string; last: string }>): Player =>
    ({ id, name: { first, last }, aliases, contact: { phone: '' } }) as Player

const players = [player('lasse', 'Lasse', 'Koskela'), player('jari', 'Jari', 'Kuusela', [{ first: 'Jartsa', last: 'Kuusela' }])]

const standings = (over: Partial<LeaderboardData> = {}): LeaderboardData => ({
    hector: [{ team: 'Lasse Koskela & Jari Kuusela', points: 71, diff: '', through: '1/6' }],
    victor: [{ player: 'Lasse Koskela', points: 42, diff: '', through: '1/6' }],
    ...over,
})

type Harness = {
    dependencies: LeaderboardDependencies
    replace: ReturnType<typeof vi.fn>
}

/**
 * Dependencies serving one event and whatever is already committed for it.
 *
 * `files` is the repository: a path that is absent reads as a file that is not
 * there, which is the state before an event's first board is published.
 */
function serving(files: Record<string, unknown>): Harness {
    const replace = vi.fn().mockResolvedValue({ ok: true, commit: 'abc123' })
    const dependencies: LeaderboardDependencies = {
        listDirectory: async (path) =>
            Object.keys(files).filter((file) => file.startsWith(`${path}/`) && file.endsWith('.json')),
        readFile: async (path) => {
            const content = files[path]
            if (content === undefined) return undefined
            return typeof content === 'string' ? content : serializeJson(content)
        },
        replace,
        now: () => duringTheEvent,
        players: async () => players,
        standings: async () => standings(),
    }
    return { dependencies, replace }
}

/** What was written to a path, parsed back. */
const written = (replace: Harness['replace'], path: string): any => {
    const call = replace.mock.calls.find((args) => args[0] === path)
    return call ? JSON.parse(call[1] as string) : undefined
}

describe('which events a run takes', () => {
    it('takes an app.hector.golf event that is being played', () => {
        const stored = [{ path: eventPath, raw: '', json: {}, event: eventJson() as never }]
        expect(eventsToUpdate(stored, '2026-09-25').map((entry) => entry.path)).toEqual([eventPath])
    })

    it('leaves a sheet-sourced event to the workflow', () => {
        // The split that keeps two writers off one file. The workflow enforces
        // the same boundary from its side.
        const stored = [{ path: eventPath, raw: '', json: {}, event: eventJson({ leaderboardSheet: SHEET }) as never }]
        expect(eventsToUpdate(stored, '2026-09-25')).toEqual([])
    })

    it('leaves an event with no live leaderboard alone', () => {
        const stored = [{ path: eventPath, raw: '', json: {}, event: eventJson({ leaderboardSheet: undefined }) as never }]
        expect(eventsToUpdate(stored, '2026-09-25')).toEqual([])
    })
})

describe('whether an event is being played', () => {
    const timing = { timing: { start: '2026-09-24', end: '2026-09-27' } }

    it('is not, the day before it starts', () => {
        expect(isBeingPlayed(timing as never, '2026-09-23')).toBe(false)
    })

    it('is, on the first day', () => {
        expect(isBeingPlayed(timing as never, '2026-09-24')).toBe(true)
    })

    it('still is, the morning after it ended', () => {
        // The day of grace: a final round that finished late is published the
        // next morning rather than never.
        expect(isBeingPlayed(timing as never, '2026-09-28')).toBe(true)
    })

    it('is not, two days after it ended', () => {
        expect(isBeingPlayed(timing as never, '2026-09-29')).toBe(false)
    })
})

describe('publishing the boards', () => {
    it('writes the standings when there is nothing committed yet', async () => {
        const { dependencies, replace } = serving({ [eventPath]: eventJson({ results: { teams: [{ name: 'x', players: ['lasse', 'jari'] }], winners: { hector: [], victor: [] } } }) })
        const result = await run(dependencies, false)

        expect(result.outcome).toBe('ok')
        const file = written(replace, boardPath)
        expect(file.event).toBe('HECTOR2026')
        expect(file.victor[0].player).toBe('Lasse Koskela')
        expect(file.scoring).toEqual({ hector: 'ascending', victor: 'descending' })
        expect(file.updatedAt).toBe(duringTheEvent.toISOString())
    })

    it('says a deploy is already starting, because it commits under astrosite/', async () => {
        const { dependencies } = serving({ [eventPath]: eventJson() })
        expect((await run(dependencies, false)).deployStartsItself).toBe(true)
    })

    it('does not commit when the boards say what is already committed', async () => {
        // The property that makes a push per birdie affordable: an unchanged
        // board is not a commit, and therefore not a site rebuild.
        const committed = {
            event: 'HECTOR2026',
            scoring: { hector: 'ascending', victor: 'descending' },
            ...standings(),
            updatedAt: '2026-09-25T09:00:00.000Z',
        }
        const { dependencies, replace } = serving({
            [eventPath]: eventJson({ results: { teams: [{ name: 'x', players: ['lasse'] }], winners: { hector: [], victor: [] } } }),
            [boardPath]: committed,
        })

        const result = await run(dependencies, false)

        expect(replace).not.toHaveBeenCalledWith(boardPath, expect.anything(), expect.anything())
        expect(result.outcome).toBe('ok')
        expect(result.deployStartsItself).toBe(false)
    })

    it('commits when only the timestamp would differ but a score moved', async () => {
        const committed = {
            event: 'HECTOR2026',
            scoring: { hector: 'ascending', victor: 'descending' },
            hector: standings().hector,
            victor: [{ player: 'Lasse Koskela', points: 40, diff: '', through: '1/6' }],
            updatedAt: '2026-09-25T09:00:00.000Z',
        }
        const { dependencies, replace } = serving({ [eventPath]: eventJson(), [boardPath]: committed })

        await run(dependencies, false)

        expect(written(replace, boardPath).victor[0].points).toBe(42)
    })

    it('writes nothing on a shadow run, and still reports what it would have written', async () => {
        const { dependencies, replace } = serving({ [eventPath]: eventJson() })
        const result = await run(dependencies, true)

        expect(replace).not.toHaveBeenCalled()
        expect(result.changes.map((change) => change.subject)).toContain('HECTOR2026')
    })

    it('refuses an event whose committed board is not valid JSON', async () => {
        // Something else is mid-write, or somebody is repairing it by hand.
        // Either way this must not land on top of it.
        const { dependencies, replace } = serving({ [eventPath]: eventJson(), [boardPath]: '{ not json' })
        const result = await run(dependencies, false)

        expect(result.outcome).toBe('failed')
        expect(replace).not.toHaveBeenCalledWith(boardPath, expect.anything(), expect.anything())
    })
})

describe('when the standings cannot be read', () => {
    it('fails the run rather than publishing an empty board', async () => {
        // The failure this job exists to not have: an event that has not started
        // legitimately has empty boards, so "could not read" must never reach the
        // file as "nobody is playing".
        const { dependencies, replace } = serving({ [eventPath]: eventJson() })
        const result = await run({ ...dependencies, standings: async () => undefined }, false)

        expect(result.outcome).toBe('failed')
        expect(result.detail).toContain('HECTOR2026')
        expect(replace).not.toHaveBeenCalled()
    })
})

describe('when no tournament is being played', () => {
    it('succeeds, and says so', async () => {
        const { dependencies, replace } = serving({
            [eventPath]: eventJson({ timing: { start: '2025-09-24', end: '2025-09-27' } }),
        })
        const result = await run(dependencies, false)

        expect(result.outcome).toBe('ok')
        expect(result.detail).toMatch(/no tournament/)
        expect(replace).not.toHaveBeenCalled()
    })
})

describe('learning the pairings from a board', () => {
    it('matches a player by name and by alias, ignoring case', () => {
        expect(playerIdByName(players, 'lasse koskela')).toBe('lasse')
        expect(playerIdByName(players, 'Jartsa Kuusela')).toBe('jari')
        expect(playerIdByName(players, 'Nobody At All')).toBeUndefined()
    })

    it('reads the teams off a board that shows them', () => {
        expect(pairingsFrom(standings().hector, players)).toEqual([
            { name: 'Lasse Koskela & Jari Kuusela', players: ['lasse', 'jari'] },
        ])
    })

    it('takes none of them when one name matches nobody', () => {
        // All or nothing. Eleven teams and a gap reads as a pair that withdrew.
        const board = [
            ...standings().hector,
            { team: 'Someone Unknown & Jari Kuusela', points: 74, diff: '+3', through: '1/6' },
        ]
        expect(pairingsFrom(board, players)).toBeUndefined()
    })

    it('takes none before the draw, when the rows have no names', () => {
        expect(pairingsFrom([{ team: '', points: 0, diff: '', through: '0/6' }], players)).toBeUndefined()
    })

    it('writes them into the event file the first time the board shows them', async () => {
        const { dependencies, replace } = serving({ [eventPath]: eventJson({ results: { teams: [], winners: { hector: [], victor: [] } } }) })
        await run(dependencies, false)

        expect(written(replace, eventPath).results).toEqual({
            teams: [{ name: 'Lasse Koskela & Jari Kuusela', players: ['lasse', 'jari'] }],
            winners: { hector: [], victor: [] },
        })
    })

    it('leaves an event that already has teams alone', async () => {
        const teams = [{ name: 'Someone & Else', players: ['lasse', 'jari'] }]
        const { dependencies, replace } = serving({
            [eventPath]: eventJson({ results: { teams, winners: { hector: [], victor: [] } } }),
        })
        await run(dependencies, false)

        expect(replace).not.toHaveBeenCalledWith(eventPath, expect.anything(), expect.anything())
    })

    it('does not ask Firestore for the players when it has nothing to learn', async () => {
        const teams = [{ name: 'Someone & Else', players: ['lasse', 'jari'] }]
        const { dependencies } = serving({
            [eventPath]: eventJson({ results: { teams, winners: { hector: [], victor: [] } } }),
        })
        const asked = vi.fn(async () => players)
        await run({ ...dependencies, players: asked }, false)

        expect(asked).not.toHaveBeenCalled()
    })
})
