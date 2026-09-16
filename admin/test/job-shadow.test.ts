import { describe, expect, it } from 'vitest'

import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'

import { documentId, missingFrom } from '../src/lib/handicaps/observations.ts'
import { decide } from '../src/lib/jobs/handicaps.ts'

/**
 * What a run decides against: the store, plus whatever the reconcile adds.
 *
 * The same expression on a dry run and a real one, which is the property worth
 * pinning — a shadow run and a live one must differ in what they *write*, not in
 * what they *conclude*. An earlier version decided against Firestore directly,
 * which on a dry run is a store the reconcile never filled, so every player read
 * as changed from nothing on every tick and the shadow diff was 45 lines of
 * noise instead of evidence.
 *
 * `history` in the job is `[...stored, ...missingFrom(stored, committed)]`, so
 * these exercise that expression.
 */

const historyOf = (stored: HandicapHistoryEntry[], committed: HandicapHistoryEntry[]) => [
    ...stored,
    ...missingFrom(stored, committed),
]

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

describe('the history a run decides against', () => {
    it('adds the committed observations the store does not have', () => {
        expect(historyOf(stored, committed).map(documentId)).toEqual([
            'a_2026-09-15_2026-09-15T03:00:00Z',
            'b_2026-09-15_2026-09-15T03:00:00Z',
        ])
    })

    it('does not duplicate one both already hold', () => {
        // Keyed on `documentId`, which is what the reconcile keys on. The two
        // disagreeing is how a shadow run would claim a change the real run
        // would not make.
        const merged = historyOf(stored, committed)
        expect(merged.filter((entry) => entry.player === 'a')).toHaveLength(1)
    })

    it('is just the store when nothing is committed', () => {
        expect(historyOf(stored, [])).toEqual(stored)
    })

    it('is just the committed history when the store is empty', () => {
        // The first shadow run on a fresh project, which is the case that was
        // wrong: an empty store plus an ignored file meant everything looked new.
        expect(historyOf([], committed)).toEqual(committed)
    })
})

describe('what a run then reports', () => {
    it('reports nothing when the scrape agrees with the committed history', () => {
        // The ordinary quiet tick. Against Firestore alone this said "2 changes".
        const history = historyOf([], committed)
        const readings = new Map([['a', 14.7], ['b', 9.4]])
        expect(decide(history, readings, NOON).changes).toEqual([])
    })

    it('reports only the handicap that actually moved', () => {
        const history = historyOf([], committed)
        const readings = new Map([['a', 14.7], ['b', 9.1]])
        expect(decide(history, readings, NOON).changes).toEqual([{ subject: 'b', from: '9.4', to: '9.1' }])
    })

    it('still reports a player the committed history has never held', () => {
        const history = historyOf([], committed)
        const readings = new Map([['c', 22]])
        expect(decide(history, readings, NOON).changes).toEqual([{ subject: 'c', from: undefined, to: '22' }])
    })
})
