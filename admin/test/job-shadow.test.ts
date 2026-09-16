import { describe, expect, it } from 'vitest'

import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'

import { documentId } from '../src/lib/handicaps/observations.ts'
import { decide, withCommitted } from '../src/lib/jobs/handicaps.ts'

/**
 * What a shadow run compares against.
 *
 * A dry run skips the reconcile, so Firestore never fills up however many times
 * it runs. Deciding against Firestore directly would therefore report every
 * player as changed from nothing, on every tick, for ever — the shadow diff
 * would be 45 lines of noise rather than the evidence the shadow period exists
 * to produce.
 *
 * So a dry run decides against the history it *would* have had. These pin that.
 */

const stored: HandicapHistoryEntry[] = [
    { player: 'a', date: '2026-09-15', handicap: 14.7, observed: '2026-09-15T03:00:00Z' },
]

const committed: HandicapHistoryEntry[] = [
    // The same observation the store already holds, as `handicaps.json` has it.
    { player: 'a', date: '2026-09-15', handicap: 14.7, observed: '2026-09-15T03:00:00Z' },
    // One the store has not seen, which is what the reconcile would add.
    { player: 'b', date: '2026-09-15', handicap: 9.4, observed: '2026-09-15T03:00:00Z' },
]

const NOON = new Date('2026-09-16T12:00:00.000Z')

describe('the history a dry run decides against', () => {
    it('adds the committed observations the store does not have', () => {
        expect(withCommitted(stored, committed).map(documentId)).toEqual([
            'a_2026-09-15_2026-09-15T03:00:00Z',
            'b_2026-09-15_2026-09-15T03:00:00Z',
        ])
    })

    it('does not duplicate one both already hold', () => {
        // Keyed on `documentId`, which is what the reconcile keys on. The two
        // disagreeing is how a shadow run would claim a change the real run
        // would not make.
        const merged = withCommitted(stored, committed)
        expect(merged.filter((entry) => entry.player === 'a')).toHaveLength(1)
    })

    it('is just the store when nothing is committed', () => {
        expect(withCommitted(stored, [])).toEqual(stored)
    })

    it('is just the committed history when the store is empty', () => {
        // The first shadow run on a fresh project, which is the case that was
        // wrong: an empty store plus an ignored file meant everything looked new.
        expect(withCommitted([], committed)).toEqual(committed)
    })
})

describe('what a shadow run then reports', () => {
    it('reports nothing when the scrape agrees with the committed history', () => {
        // The ordinary quiet tick. Against Firestore alone this said "2 changes".
        const history = withCommitted([], committed)
        const readings = new Map([['a', 14.7], ['b', 9.4]])
        expect(decide(history, readings, NOON).changes).toEqual([])
    })

    it('reports only the handicap that actually moved', () => {
        const history = withCommitted([], committed)
        const readings = new Map([['a', 14.7], ['b', 9.1]])
        expect(decide(history, readings, NOON).changes).toEqual([{ subject: 'b', from: '9.4', to: '9.1' }])
    })

    it('still reports a player the committed history has never held', () => {
        const history = withCommitted([], committed)
        const readings = new Map([['c', 22]])
        expect(decide(history, readings, NOON).changes).toEqual([{ subject: 'c', from: undefined, to: '22' }])
    })
})
