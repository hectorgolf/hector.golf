import type { HectorEvent, HectorGameFormat, HectorRound } from '@hector/schemas/src/events.ts'

/**
 * A Hector event's rounds, buckets and results, put into English.
 *
 * Separate from the page because none of it needs Firestore, a request or a
 * browser: it is arithmetic and string-building over a parsed event, which is
 * the half of a page worth having tests for. The page is then markup around
 * these answers.
 *
 * Reading rather than writing, deliberately.
 * `docs/plans/authoring-players-and-events.md` recommends *against* a structured
 * form over `rounds` — ten format names, per-competition contributions, two
 * bonus fields and a conditional opening-shots rule, edited twice a year — and
 * proposes a validated textarea instead. That recommendation is about editing.
 * Reading the same structure is where the detail earns its keep: it is the one
 * view that says what a round actually plays without anybody opening the JSON.
 */

/** "Day 2, round 1" — a round has no name, only a place in the schedule. */
export function roundLabel(round: HectorRound): string {
    return `Day ${round.day}, round ${round.round}`
}

/**
 * A 0–1 fraction as a percentage: 1 → "100%", 0.33 → "33%", 0.2 → "20%".
 *
 * Rounded to whole percent because the data has no finer intent than that —
 * `0.33` is a third of a competition, written as two digits by whoever typed it,
 * and "33.000000000000004%" is the floating-point arithmetic showing through.
 */
export function asPercentage(fraction: number): string {
    return `${Math.round(fraction * 100)}%`
}

/**
 * The competitions a game format counts towards, or what it is when it counts
 * towards none.
 *
 * "Neither" rather than an empty string: a round with no competition is a real
 * arrangement — HECTOR2025 plays a Stroke Play SCR alongside a scoring format —
 * and a blank cell reads as missing data rather than as the answer.
 */
export function competitionsOf(format: HectorGameFormat): string {
    const competitions = format.competition ?? []
    if (competitions.length === 0) return 'Neither'
    return competitions.map((c) => (c === 'hector' ? 'Hector' : 'Victor')).join(' & ')
}

const TEAM_CONTRIBUTION: Record<NonNullable<HectorGameFormat['teamContribution']>, string> = {
    both: 'both partners score',
    better: 'the better partner scores',
    team: 'one team score',
}

/**
 * Everything about a game format other than its name and its competitions, as
 * short phrases a page can list.
 *
 * A list rather than one sentence because what is present varies per format and
 * the absent ones must not leave punctuation behind. Absent means "does not
 * apply" throughout — a format with no `birdieBonus` does not award one — so
 * nothing here has a default to print.
 */
export function gameFormatDetails(format: HectorGameFormat): string[] {
    const details: string[] = []

    if (format.handicapAllowance !== undefined) {
        details.push(
            format.handicapAllowance === 0
                ? 'scratch'
                : `${asPercentage(format.handicapAllowance)} handicap allowance`
        )
    }
    if (format.teamContribution) details.push(TEAM_CONTRIBUTION[format.teamContribution])

    // Named in a fixed order rather than walked with Object.entries, so the line
    // reads the same whichever order the two keys were typed in the file.
    for (const competition of ['hector', 'victor'] as const) {
        const share = format.contribution?.[competition]
        if (share === undefined) continue
        const name = competition === 'hector' ? 'Hector' : 'Victor'
        details.push(`${asPercentage(share)} of the ${name}`)
    }

    if (format.birdieBonus) details.push(`birdie bonus ${format.birdieBonus}`)
    if (format.eagleBonus) details.push(`eagle bonus ${format.eagleBonus}`)

    const opening = format.openingShotsRequirement
    if (opening?.minimumPerPlayer) {
        const penalty = opening.penaltyPerMissingStroke
        details.push(
            penalty
                ? `${opening.minimumPerPlayer} opening shots each, ${penalty} per missing one`
                : `${opening.minimumPerPlayer} opening shots each`
        )
    }

    return details
}

/** The cap a round plays, which is the event's unless the round says otherwise. */
export function maxStrokesOverParOf(event: HectorEvent, round: HectorRound): number {
    return round.maxStrokesOverPar ?? event.maxStrokesOverPar
}

type Bucket = NonNullable<HectorEvent['buckets']>[number]

/**
 * How a split is described in one line: "2 buckets of 12", or the sizes spelled
 * out when they differ.
 *
 * The uneven case is the one worth handling rather than the tidy one. A Hector's
 * field is whoever signed up, so the even split is luck; the sizes are what
 * somebody checking a Draft actually wants, and "3 buckets" alone does not say
 * whether one of them is short.
 */
export function bucketsSummary(buckets: readonly Bucket[] | undefined): string {
    if (!buckets || buckets.length === 0) return 'No split drawn'
    const sizes = buckets.map((bucket) => bucket.length)
    const plural = buckets.length === 1 ? 'bucket' : 'buckets'
    if (new Set(sizes).size === 1) return `${buckets.length} ${plural} of ${sizes[0]}`
    return `${buckets.length} ${plural}: ${sizes.join(', ')}`
}

/**
 * The handicap span a bucket covers, as the split was drawn.
 *
 * From the handicaps stored in `event.buckets` rather than from today's, which
 * is the distinction `architecture.md` §13 records the public site getting wrong
 * on a finished event: the split is a historical fact about the morning it was
 * drawn, and re-deriving it from the current history answers a different
 * question. Here the stored value is the only one available, which makes this
 * right by construction — worth saying so it stays that way.
 */
export function bucketRange(bucket: Bucket): string | undefined {
    const handicaps = bucket
        .map((entry) => entry.handicap)
        .filter((handicap): handicap is number => handicap !== undefined)
    if (handicaps.length === 0) return undefined
    const low = Math.min(...handicaps)
    const high = Math.max(...handicaps)
    return low === high ? `${low}` : `${low} to ${high}`
}
