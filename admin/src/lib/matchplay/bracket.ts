import type { MatchplayMatch, MatchplayResults } from '@hector/schemas/src/events.ts'

/**
 * Drawing and running a single-elimination bracket.
 *
 * Pure functions over plain data: no Firestore, no Astro, no clock. The bracket
 * is the one part of this feature with real rules, so it is the part worth being
 * able to test exhaustively without standing anything up.
 */

export type Seed = { id: string; handicap?: number }

export type DrawStrategy = 'random' | 'similar' | 'contrast'

export const DRAW_STRATEGIES: { value: DrawStrategy; label: string; description: string }[] = [
    { value: 'random', label: 'Random', description: 'Shuffle the field and pair them off.' },
    {
        value: 'similar',
        label: 'Similar handicaps',
        description: 'Sort by handicap and pair neighbours, so first-round matches are close.',
    },
    {
        value: 'contrast',
        label: 'Lowest against highest',
        description: 'Sort by handicap and pair the top of the field against the bottom.',
    },
]

/** A field must halve cleanly all the way down, or some players get no match. */
export function isDrawableFieldSize(size: number): boolean {
    return size >= 2 && (size & (size - 1)) === 0
}

/** The next field size that would work, for telling an admin how far off they are. */
export function nextDrawableSize(size: number): number {
    let n = 2
    while (n < size) n *= 2
    return n
}

/** Match ids are M01, M02 … in bracket order, which is how the existing events read. */
function matchId(index: number): string {
    return `M${String(index + 1).padStart(2, '0')}`
}

/**
 * A player with no handicap sorts last rather than first. An unknown handicap is
 * missing information, and treating it as scratch would seed a newcomer as the
 * strongest player in the field.
 */
function byHandicap(a: Seed, b: Seed): number {
    const ah = a.handicap ?? Number.POSITIVE_INFINITY
    const bh = b.handicap ?? Number.POSITIVE_INFINITY
    return ah === bh ? a.id.localeCompare(b.id) : ah - bh
}

/**
 * Order the field into first-round pairs: the list is read two at a time, so
 * positions 0 and 1 meet, 2 and 3 meet, and so on.
 *
 * `random` takes an injected shuffle so a caller — a test — can make it
 * deterministic without the strategy needing to know it is being tested.
 */
export function orderForDraw(
    seeds: readonly Seed[],
    strategy: DrawStrategy,
    shuffle: (xs: Seed[]) => Seed[] = defaultShuffle
): Seed[] {
    const sorted = [...seeds].sort(byHandicap)

    switch (strategy) {
        case 'random':
            return shuffle([...seeds])
        case 'similar':
            // Already adjacent by handicap, so reading it in pairs gives close matches.
            return sorted
        case 'contrast': {
            // Fold the sorted list: best v worst, second-best v second-worst.
            const out: Seed[] = []
            let low = 0
            let high = sorted.length - 1
            while (low < high) {
                out.push(sorted[low]!, sorted[high]!)
                low += 1
                high -= 1
            }
            return out
        }
    }
}

function defaultShuffle(xs: Seed[]): Seed[] {
    for (let i = xs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[xs[i], xs[j]] = [xs[j]!, xs[i]!]
    }
    return xs
}

/**
 * Build the whole bracket from an ordered field.
 *
 * Every match exists from the start, including the final. Later rounds carry
 * `leftSource`/`rightSource` naming the matches that feed them and `null`
 * players until those are decided — which is the shape the existing events use
 * and what lets the public bracket render before anything has been played.
 */
export function drawBracket(ordered: readonly Seed[]): MatchplayResults['bracket'] {
    if (!isDrawableFieldSize(ordered.length)) {
        throw new Error(
            `A bracket needs a power-of-two field; got ${ordered.length}. ` +
                `The nearest workable size is ${nextDrawableSize(ordered.length)}.`
        )
    }

    const bracket: MatchplayResults['bracket'] = []
    let created = 0
    let previousRoundIds: string[] = []

    for (let size = ordered.length; size >= 2; size /= 2) {
        const round = bracket.length + 1
        const matches: MatchplayMatch[] = []

        for (let i = 0; i < size / 2; i += 1) {
            const id = matchId(created)
            created += 1

            const isFirstRound = round === 1
            matches.push({
                id,
                leftSource: isFirstRound ? null : (previousRoundIds[i * 2] ?? null),
                rightSource: isFirstRound ? null : (previousRoundIds[i * 2 + 1] ?? null),
                left: isFirstRound ? (ordered[i * 2]?.id ?? null) : null,
                right: isFirstRound ? (ordered[i * 2 + 1]?.id ?? null) : null,
                score: null,
                winner: null,
            })
        }

        bracket.push({ round, matches })
        previousRoundIds = matches.map((m) => m.id)
    }

    return bracket
}

export type RecordResult = { matchId: string; score: string; winner: string }

/**
 * Record a result and carry the winner into whichever match is fed by this one.
 *
 * Returns a new bracket; nothing is mutated, so a caller can diff or discard it.
 * Advancement follows `leftSource`/`rightSource` rather than arithmetic on match
 * numbers, so it keeps working if a bracket is ever built some other way.
 */
export function recordResult(
    bracket: MatchplayResults['bracket'],
    { matchId: id, score, winner }: RecordResult
): MatchplayResults['bracket'] {
    const match = bracket.flatMap((r) => r.matches).find((m) => m.id === id)
    if (!match) throw new Error(`No match ${id} in this bracket.`)

    const contenders = [match.left, match.right].filter((p): p is string => p !== null)
    if (!contenders.includes(winner)) {
        throw new Error(`${winner} is not playing in ${id}.`)
    }

    return bracket.map((round) => ({
        ...round,
        matches: round.matches.map((m) => {
            if (m.id === id) return { ...m, score, winner }
            // Whoever this match was waiting on has now been decided.
            if (m.leftSource === id) return { ...m, left: winner }
            if (m.rightSource === id) return { ...m, right: winner }
            return m
        }),
    }))
}

/** The tournament winner: whoever won the last round's only match. */
export function championOf(bracket: MatchplayResults['bracket']): string | undefined {
    const final = bracket.at(-1)?.matches
    if (final?.length !== 1) return undefined
    return final[0]?.winner ?? undefined
}

/** Matches that can be played now: both players known, no result yet. */
export function playableMatches(bracket: MatchplayResults['bracket']): MatchplayMatch[] {
    return bracket
        .flatMap((r) => r.matches)
        .filter((m) => m.left !== null && m.right !== null && m.winner === null)
}
