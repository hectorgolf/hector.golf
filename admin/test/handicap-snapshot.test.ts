import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type HandicapHistoryEntry, latestPerDay } from '@hector/schemas/src/handicaps.ts'

import { LATEST, SNAPSHOTS, read, snapshotOf, write } from '../src/lib/handicaps/snapshot.ts'

/**
 * The derived document, checked against the thing it is derived from.
 *
 * A snapshot is only worth having if it says the same thing the log says. The
 * load-bearing test below is therefore not "the code does what the code does"
 * but an equality against `latestPerDay` over the 1,408 entries actually in git
 * — the same comparison `handicap-observations.test.ts` makes for the backup,
 * for the same reason: this is the one assertion that fails if the derivation
 * ever quietly stops meaning "latest".
 *
 * The rest is about the failure mode the plan's "reconcile, never append" rule
 * exists to prevent, in its new shape: a snapshot that is merged into rather
 * than rebuilt drifts silently, and nothing downstream can tell.
 */

const committed: HandicapHistoryEntry[] = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../astrosite/src/data/handicaps.json'), 'utf-8')
)

const GENERATED = '2026-09-18T08:27:26.000Z'

/**
 * What every player's latest handicap is, worked out independently of the module
 * under test: `latestPerDay` is ordered oldest first, so the last entry each
 * player appears in is theirs.
 */
function latestPerPlayer(entries: readonly HandicapHistoryEntry[]): Map<string, HandicapHistoryEntry> {
    const latest = new Map<string, HandicapHistoryEntry>()
    for (const entry of latestPerDay(entries)) latest.set(entry.player, entry)
    return latest
}

/**
 * Firestore's own rule about `undefined`, which a lenient fake would hide.
 *
 * The same stand-in `job-log.test.ts` grew after a successful run failed to
 * record itself in production. It matters more here than it looks: 29 of the 40
 * players in the committed history have no `observed` on their latest reading,
 * so a snapshot that wrote the field as `undefined` rather than omitting it
 * would be refused for most of the roster, on every run.
 */
function rejectUndefined(value: unknown, path: string): void {
    if (value === undefined) {
        throw new Error(
            `Value for argument "data" is not a valid Firestore document. ` +
                `Cannot use "undefined" as a Firestore value (found in field "${path}").`
        )
    }
    if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) rejectUndefined(nested, path ? `${path}.${key}` : key)
    }
}

/**
 * A store that replaces a document on `set` and merges only when asked to,
 * because that distinction is the one thing these tests are really about.
 */
function fakeFirestore(initial?: Record<string, unknown>) {
    const documents = new Map<string, Record<string, unknown>>()
    if (initial) documents.set(`${SNAPSHOTS}/${LATEST}`, initial)
    const writes: { path: string; merge: boolean }[] = []

    const db = {
        collection: (name: string) => ({
            doc: (id: string) => {
                const path = `${name}/${id}`
                return {
                    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
                        rejectUndefined(data, '')
                        writes.push({ path, merge: options?.merge === true })
                        documents.set(
                            path,
                            options?.merge === true ? { ...(documents.get(path) ?? {}), ...data } : data
                        )
                    },
                    get: async () => {
                        const data = documents.get(path)
                        return { exists: data !== undefined, data: () => data }
                    },
                }
            },
        }),
    }
    return { db: db as any, documents, writes }
}

describe('deriving the snapshot', () => {
    it('says exactly what `latestPerDay` says, for every entry ever committed', () => {
        // The assertion this whole module is answerable to. Anything that makes
        // the snapshot and the history disagree about a player's handicap shows
        // up here against real data rather than against a fixture that was
        // written to agree.
        const expected = latestPerPlayer(committed)
        const snapshot = snapshotOf(committed, GENERATED)

        expect(Object.keys(snapshot.players).sort()).toEqual([...expected.keys()].sort())
        for (const [player, entry] of expected) {
            expect(snapshot.players[player]).toEqual(
                entry.observed === undefined
                    ? { handicap: entry.handicap }
                    : { handicap: entry.handicap, observed: entry.observed }
            )
        }
        // Not vacuous: the history has 40 players in it, and a snapshot of
        // nothing would satisfy every loop above.
        expect(Object.keys(snapshot.players).length).toBe(40)
    })

    it('takes the later reading when a player moved twice in a day', () => {
        // The dual-run shape, which is now every change: the job stamps
        // `observed` when it scrapes and the workflow stamps a later one when it
        // commits. Fed out of order deliberately, so that a derivation keying on
        // "whichever row came first" fails rather than passes by luck.
        const history: HandicapHistoryEntry[] = [
            { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T13:41:09Z' },
            { player: 'sami-h', date: '2026-09-18', handicap: 4.8, observed: '2026-09-18T05:00:35Z' },
        ]
        expect(snapshotOf(history, GENERATED).players['sami-h']).toEqual({
            handicap: 5.2,
            observed: '2026-09-18T13:41:09Z',
        })
    })

    it('takes the later day, not the last row it was handed', () => {
        const history: HandicapHistoryEntry[] = [
            { player: 'lasse-k', date: '2026-09-13', handicap: 14.4 },
            { player: 'lasse-k', date: '2024-05-19', handicap: 14.7 },
        ]
        expect(snapshotOf(history, GENERATED).players['lasse-k']!.handicap).toBe(14.4)
    })

    it('holds what the history observed, not what a page would resolve', () => {
        // The stopgap stays out. A player with a hand-set `handicap` on their
        // record and nothing in the history is absent here, and that absence is
        // the information: it is how a caller tells "WiseGolf has never heard of
        // them" from "WiseGolf says this".
        const snapshot = snapshotOf([{ player: 'lasse-k', date: '2026-09-13', handicap: 14.4 }], GENERATED)
        expect(snapshot.players['someone-wisegolf-never-heard-of']).toBeUndefined()
    })

    it('omits `observed` rather than writing it as undefined', () => {
        const snapshot = snapshotOf([{ player: 'lasse-k', date: '2024-05-19', handicap: 14.7 }], GENERATED)
        expect(Object.keys(snapshot.players['lasse-k']!)).toEqual(['handicap'])
    })

    it('is empty rather than absent when the history is', () => {
        expect(snapshotOf([], GENERATED)).toEqual({ generated: GENERATED, players: {} })
    })
})

describe('writing the snapshot', () => {
    it('recomputes the whole document rather than merging into the old one', async () => {
        /*
         * The failure this prevents, which has no symptom until somebody asks
         * why a player nobody has scraped in months still has a handicap: a
         * patched snapshot keeps every player it has ever seen, at whatever
         * value it last saw, and the stale rows are indistinguishable from the
         * fresh ones.
         *
         * The prior document below holds a player the history no longer mentions
         * and a stale value for one it does. A `set` with `{ merge: true }`
         * leaves both; a recompute leaves neither.
         */
        const stale = {
            generated: '2026-01-01T00:00:00.000Z',
            players: {
                'lasse-k': { handicap: 99.9 },
                'left-the-club': { handicap: 12.3, observed: '2025-06-01T03:02:42Z' },
            },
        }
        const { db, documents, writes } = fakeFirestore(stale)

        const history: HandicapHistoryEntry[] = [
            { player: 'lasse-k', date: '2026-09-13', handicap: 14.4 },
            { player: 'sami-h', date: '2026-09-18', handicap: 5.2, observed: '2026-09-18T05:00:35Z' },
        ]
        await write(history, { db, now: new Date(GENERATED) })

        expect(documents.get(`${SNAPSHOTS}/${LATEST}`)).toEqual({
            generated: GENERATED,
            players: {
                'lasse-k': { handicap: 14.4 },
                'sami-h': { handicap: 5.2, observed: '2026-09-18T05:00:35Z' },
            },
        })
        // Stated separately from the equality above, because this is the clause
        // a future "just update what changed" would break first.
        expect(writes).toEqual([{ path: `${SNAPSHOTS}/${LATEST}`, merge: false }])
    })

    it('writes the committed history as one document the roster can read', async () => {
        const { db, documents } = fakeFirestore()

        const snapshot = await write(committed, { db, now: new Date(GENERATED) })

        expect(documents.get(`${SNAPSHOTS}/${LATEST}`)).toEqual(snapshot)
        // The point of the exercise: one read where a scan of the log is 1,408.
        expect(documents.size).toBe(1)
        expect(Object.keys(snapshot.players).length).toBe(40)
    })

    it('stamps when it ran, so a snapshot nobody has rebuilt can be spotted', async () => {
        const { db } = fakeFirestore()
        const snapshot = await write(committed, { db, now: new Date(GENERATED) })
        expect(snapshot.generated).toBe(GENERATED)
    })
})

describe('reading the snapshot', () => {
    it('reads back what was written', async () => {
        const { db } = fakeFirestore()
        const written = await write(committed, { db, now: new Date(GENERATED) })
        expect(await read({ db })).toEqual(written)
    })

    it('answers `undefined` when nothing has written one yet', async () => {
        // Normal rather than exceptional — an emulator, a fresh database, or
        // production before the job is wired up. Callers fall back; they do not
        // fail.
        const { db } = fakeFirestore()
        expect(await read({ db })).toBeUndefined()
    })
})
