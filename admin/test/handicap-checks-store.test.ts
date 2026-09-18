import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type HandicapCheck, lastCheckedFor } from '@hector/schemas/src/handicap-checks.ts'

import { documentId, missingFrom, parse, render } from '../src/lib/handicaps/checks.ts'

/**
 * The replay, for the sweep log: the committed history, through the new storage,
 * and back out.
 *
 * The same offline argument `handicap-observations.test.ts` makes. The two risky
 * assumptions — that a sweep can be given a stable document id, and that the
 * rendered backup is the same data as the file it replaces — are both decidable
 * against the entries already in git, and neither has to wait for a deploy.
 */
const committed: HandicapCheck[] = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../astrosite/src/data/handicap-checks.json'), 'utf-8'),
)

describe('the document id', () => {
    it('is unique across every sweep ever committed', () => {
        // The assumption the reconcile rests on: a collision means the second
        // sweep silently overwrites the first and the log is quietly shorter.
        const ids = committed.map(documentId)
        expect(new Set(ids).size).toBe(committed.length)
    })

    it('is the instant itself, with no composite key bolted on', () => {
        // Unlike an observation, which is about a player and a day and needed
        // `observed` added to tell two readings apart. A sweep is about a moment.
        expect(documentId(committed[0]!)).toBe(committed[0]!.at)
    })

    it('is a usable Firestore document id', () => {
        // Firestore forbids `/`, the two dot names, and anything matching
        // `__.*__`. An ISO instant is none of those, but it is worth asserting
        // rather than assuming, because the failure is at write time in
        // production and not at build time here.
        for (const id of committed.map(documentId)) {
            expect(id).not.toContain('/')
            expect(id).not.toMatch(/^__.*__$/)
            expect(id).not.toMatch(/^\.\.?$/)
        }
    })
})

describe('rendering the backup', () => {
    it('round-trips every committed sweep without losing or inventing one', () => {
        const back = parse(render(committed))
        expect(back.length).toBe(committed.length)
        expect(new Set(back.map(documentId))).toEqual(new Set(committed.map(documentId)))
    })

    it('preserves the answer every reader of this log actually asks', () => {
        // `lastCheckedFor` is the whole public surface: what the events payload
        // calls to date a handicap. Asserted per player against the real data,
        // because a rendering bug that survived the round-trip would still show
        // up here.
        const players = [...new Set(committed.flatMap((check) => check.skipped))]
        expect(players.length).toBeGreaterThan(0)

        const back = parse(render(committed))
        for (const player of players) {
            expect(lastCheckedFor(back, player), player).toEqual(lastCheckedFor(committed, player))
        }
    })

    /*
     * The distinction the schema calls the thing that makes real and
     * reconstructed sweeps "tellable apart forever". Six of the committed entries
     * carry it and thirty do not, so writing `approximate: false` on the thirty
     * would erase the difference while appearing to preserve it.
     */
    it('omits `approximate` rather than writing it as false', () => {
        const real = committed.find((check) => check.approximate === undefined)!
        const reconstructed = committed.find((check) => check.approximate === true)!

        expect(render([real])).not.toContain('approximate')
        expect(render([reconstructed])).toContain('"approximate":true')
        expect(parse(render([real]))[0]!.approximate).toBeUndefined()
    })

    it('is stable: rendering twice produces the same bytes', () => {
        // An unstable render commits a whole-file change on every tick, and the
        // append-only guard refuses every one of them.
        expect(render(committed)).toBe(render([...committed].reverse()))
    })

    it('writes one object per line, oldest first, with a trailing newline', () => {
        const ndjson = render(committed)
        const lines = ndjson.trimEnd().split('\n')

        expect(ndjson.endsWith('\n')).toBe(true)
        expect(lines).toHaveLength(committed.length)

        const ats = lines.map((line) => JSON.parse(line).at as string)
        expect(ats).toEqual([...ats].sort())
    })

    it('renders an empty log as an empty string rather than a blank line', () => {
        expect(render([])).toBe('')
        expect(parse('')).toEqual([])
    })
})

describe('reconciling what git holds into the store', () => {
    it('finds everything missing from an empty store', () => {
        expect(missingFrom([], committed)).toHaveLength(committed.length)
    })

    it('finds nothing missing once the store holds it', () => {
        expect(missingFrom(committed, committed)).toEqual([])
    })

    it('finds only the sweeps the store has not seen', () => {
        const [first, ...rest] = committed
        expect(missingFrom(rest, committed)).toEqual([first])
    })
})
