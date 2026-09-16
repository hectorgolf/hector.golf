import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    DriftingHandicapSource,
    driftedAfter,
    handicapAfter,
    MAX_DRIFT,
    moversOnTick,
    MOVERS_PER_TICK,
    TICK_MS,
    type RosterEntry,
} from '@hector/wisegolf/src/drifting-handicap-source.ts'
import { rosterFrom, standInFromRoster } from '@hector/wisegolf/src/stand-in.ts'

/** Two dozen, the size `dev-fake.ts` builds and the size the rules are stated for. */
const roster: RosterEntry[] = Array.from({ length: 24 }, (_, index) => ({
    firstName: `First${index}`,
    lastName: `Last${index}`,
    club: index % 3 === 0 ? 'VGC' : index % 3 === 1 ? 'TaG' : 'HGK',
    handicap: 5 + index * 0.7,
}))

const seed = 'test'

/**
 * The drift, as arithmetic rather than as something to sit and watch.
 *
 * The handicap is a pure function of (roster, seed, tick), which is the whole
 * reason there is no timer in the stand-in: every rule below is a claim about a
 * number, checkable over a thousand simulated ticks in a millisecond rather than
 * over three days of a dev server.
 */
describe('how far a handicap may wander', () => {
    it('starts every player where the roster put them', () => {
        for (const entry of roster) {
            expect(handicapAfter(entry, roster, 0, seed)).toBe(entry.handicap)
        }
    })

    /**
     * The property that makes the stand-in worth leaving running: a roster that
     * still looks like the roster tomorrow morning. A walk that was merely
     * random would be a field of noise by then, and nothing about it would
     * resemble the data the site holds.
     */
    it('never strays more than ±2.0 from where the player started', () => {
        // Every tick of the first day, then spot checks a week and a month out.
        // The clamp is applied on every step, so the invariant holds by
        // construction; what these catch is the construction changing.
        const ticks = [...Array.from({ length: 289 }, (_, index) => index), 2016, 8640]
        for (const tick of ticks) {
            const handicaps = driftedAfter(roster, tick, seed)
            for (const entry of roster) {
                const handicap = handicaps.get(`${entry.firstName.toLowerCase()} ${entry.lastName.toLowerCase()}`)!
                expect(Math.abs(handicap - entry.handicap)).toBeLessThanOrEqual(MAX_DRIFT + 1e-9)
            }
        }
    })

    it('keeps handicaps to one decimal, the way the player files hold them', () => {
        for (const entry of roster.slice(0, 5)) {
            for (let tick = 0; tick <= 200; tick += 1) {
                const handicap = handicapAfter(entry, roster, tick, seed)
                expect(Math.round(handicap * 10)).toBeCloseTo(handicap * 10, 9)
            }
        }
    })

    it('actually moves people, rather than being a very elaborate constant', () => {
        const moved = roster.filter((entry) => handicapAfter(entry, roster, 50, seed) !== entry.handicap)
        expect(moved.length).toBeGreaterThan(roster.length / 2)
    })
})

describe('who moves on a tick', () => {
    /**
     * Exactly the proportion, every tick, rather than the proportion on average.
     * A tick that happened to move nobody — or everybody — is indistinguishable
     * from the stand-in being broken, which is a bad way to spend an afternoon.
     */
    it('moves the same number of players every time, not a number on average', () => {
        const expected = Math.round(roster.length * MOVERS_PER_TICK)
        for (let tick = 1; tick <= 100; tick += 1) {
            expect(moversOnTick(roster, tick, seed).size).toBe(expected)
        }
    })

    it("is 2 or 3 for a roster of 24 — 10% of 24 is 2.4, not 4", () => {
        // Worth stating in a test rather than a comment, because "10%" and
        // "about four players" were both said out loud while this was specified
        // and they are not the same rule. This is the 10% one. To move four of
        // twenty-four, MOVERS_PER_TICK wants to be nearer 0.17.
        expect(moversOnTick(roster, 1, seed).size).toBe(2)
    })

    it('does not move the same people every tick', () => {
        const first = [...moversOnTick(roster, 1, seed)].sort().join()
        const later = [...moversOnTick(roster, 2, seed)].sort().join()
        expect(first).not.toBe(later)
    })

    it('leaves everybody who was not picked exactly where they were', () => {
        const movers = moversOnTick(roster, 1, seed)
        const after = driftedAfter(roster, 1, seed)

        const untouched = roster.filter(
            (entry) => !movers.has(`${entry.firstName.toLowerCase()} ${entry.lastName.toLowerCase()}`)
        )
        expect(untouched.length).toBe(roster.length - movers.size)

        for (const entry of untouched) {
            const key = `${entry.firstName.toLowerCase()} ${entry.lastName.toLowerCase()}`
            expect(after.get(key)).toBe(entry.handicap)
        }
    })

    it('never picks nobody, even for a roster too small for the percentage', () => {
        const tiny: RosterEntry[] = [{ firstName: 'Solo', lastName: 'Player', club: 'VGC', handicap: 10 }]
        expect(moversOnTick(tiny, 1, seed).size).toBe(1)
    })
})

describe('the same seed, the same afternoon', () => {
    it('replays identically, so a confusing run can be run again', () => {
        const once = roster.map((entry) => handicapAfter(entry, roster, 37, seed))
        const twice = roster.map((entry) => handicapAfter(entry, roster, 37, seed))
        expect(twice).toEqual(once)
    })

    it('gives a different sequence for a different seed', () => {
        const mine = roster.map((entry) => handicapAfter(entry, roster, 37, 'one'))
        const yours = roster.map((entry) => handicapAfter(entry, roster, 37, 'two'))
        expect(yours).not.toEqual(mine)
    })
})

describe('the source, as the sweep asks it', () => {
    const at = (elapsedMs: number) =>
        new DriftingHandicapSource({ roster, seed, startedAt: 0, now: () => elapsedMs })

    it('answers with the starting handicap before five minutes have passed', async () => {
        const source = at(TICK_MS - 1)
        expect(source.tick()).toBe(0)
        expect(await source.getPlayerHandicap('First0', 'Last0', 'VGC')).toBe(roster[0]!.handicap)
    })

    it('has moved somebody once five minutes have passed', async () => {
        const source = at(TICK_MS)
        expect(source.tick()).toBe(1)

        const readings = await Promise.all(
            roster.map((entry) => source.getPlayerHandicap(entry.firstName, entry.lastName, entry.club))
        )
        const moved = readings.filter((handicap, index) => handicap !== roster[index]!.handicap)
        expect(moved.length).toBe(Math.round(roster.length * MOVERS_PER_TICK))
    })

    it('counts a tick per five minutes', () => {
        expect(at(0).tick()).toBe(0)
        expect(at(TICK_MS * 12).tick()).toBe(12)
        // A clock that went backwards is a clock, not a reason to crash.
        expect(at(-TICK_MS).tick()).toBe(0)
    })

    it('matches a name however it was capitalised or padded', async () => {
        const source = at(0)
        expect(await source.getPlayerHandicap('  first0 ', 'LAST0', 'VGC')).toBe(roster[0]!.handicap)
    })

    /**
     * Undefined rather than a guess, the way a real source answers for somebody
     * it has never heard of. It is what puts a player on the sweep's `skipped`
     * list, and that list is a real state worth being able to see locally —
     * WiseGolf does not know every Hector player either.
     */
    it('has never heard of somebody who is not on the roster', async () => {
        expect(await at(0).getPlayerHandicap('Nobody', 'Here', 'VGC')).toBeUndefined()
        expect(await at(0).resolveClubMembership('Nobody', 'Here')).toEqual([])
    })

    it('knows the clubs the roster plays for, and no others', async () => {
        const clubs = await at(0).getClubs()
        expect(clubs.map((club) => club.abbreviation)).toEqual(['HGK', 'TaG', 'VGC'])
    })

    it('resolves a membership from the roster', async () => {
        const clubs = await at(0).resolveClubMembership('First0', 'Last0')
        expect(clubs.map((club) => club.abbreviation)).toEqual(['VGC'])
    })

    it('says in its name that it is not WiseGolf', () => {
        expect(at(0).name).toContain('stand-in')
    })
})

/**
 * Selecting it. The variable names a roster *file*, so what it carries is data
 * — the same shape as `GITHUB_API_BASE_URL`, and for the same reason: a boolean
 * would be a switch that picks an implementation, and this repository argues at
 * length against having one of those.
 */
describe('choosing the stand-in', () => {
    const rosterFile = (contents: unknown): string => {
        const path = join(mkdtempSync(join(tmpdir(), 'roster-test-')), 'roster.json')
        writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
        return path
    }

    it('is off unless a roster is named', async () => {
        expect(await standInFromRoster(undefined)).toBeUndefined()
        expect(await standInFromRoster('')).toBeUndefined()
    })

    it('reads a roster and drifts it', async () => {
        const path = rosterFile([{ firstName: 'A', lastName: 'B', club: 'VGC', handicap: 12.3 }])
        const source = await standInFromRoster(path)

        expect(source).toBeDefined()
        expect(await source!.getPlayerHandicap('A', 'B', 'VGC')).toBe(12.3)
    })

    /**
     * Belt and braces: nothing deployed sets this, because Terraform would have
     * to. But a scrape that invents handicaps and then commits them is bad
     * enough to be worth a second lock, and a misconfiguration must not resolve
     * itself into the one outcome nobody asked for.
     */
    it('refuses to be used in production, loudly', async () => {
        const path = rosterFile([{ firstName: 'A', lastName: 'B', club: 'VGC', handicap: 12.3 }])
        const was = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
            await expect(standInFromRoster(path)).rejects.toThrow(/production/)
        } finally {
            process.env.NODE_ENV = was
        }
    })

    it('names the file when the roster is unreadable, since a script wrote it', () => {
        expect(() => rosterFrom('/nowhere/at/all/roster.json')).toThrow(/\/nowhere\/at\/all\/roster\.json/)
        expect(() => rosterFrom(rosterFile('not json'))).toThrow(/Could not read/)
        expect(() => rosterFrom(rosterFile([]))).toThrow(/non-empty array/)
        expect(() => rosterFrom(rosterFile([{ firstName: 'A' }]))).toThrow(/firstName, lastName, club/)
        expect(() => rosterFrom(rosterFile([{ firstName: 'A', lastName: 'B', club: 'V' }]))).toThrow(/handicap/)
    })
})
