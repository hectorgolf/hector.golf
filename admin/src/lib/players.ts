import type { Player } from '@hector/schemas/src/players.ts'

import type { PlayerHandicap } from './handicaps/snapshot.ts'

/** How a player is named in the admin UI: full, never privacy-shortened. */
export function fullName(player: Player): string {
    return `${player.name.first} ${player.name.last}`
}

export function nameById(players: readonly Player[]): Map<string, string> {
    return new Map(players.map((p) => [p.id, fullName(p)]))
}

/** Resolve an id to a name, falling back to the id so a stale reference is visible. */
export function displayName(names: Map<string, string>, id: string | null | undefined): string {
    if (!id) return '—'
    return names.get(id) ?? id
}

/**
 * Which of the two places a handicap can come from this one came from.
 *
 * `observed` is what WiseGolf last reported, by way of the handicap snapshot.
 * `stopgap` is `player.handicap`: a figure somebody typed for a player WiseGolf
 * has never heard of, which `docs/current/data-ownership.md` is emphatic is not
 * an override. That distinction is the whole reason this returns a shape rather
 * than a number — a page that shows both as "12.4" is the page that makes
 * somebody read a stopgap as an override, and then read its replacement as their
 * own edit being lost.
 */
export type HandicapSource = 'observed' | 'stopgap'

export type ResolvedHandicap = {
    value: number
    source: HandicapSource
    /** When the reading was taken, for an observed one the snapshot dated. */
    observed?: string
}

/**
 * A player's handicap and where it came from.
 *
 * Official first, then the stopgap — the same order as the site's
 * `resolveHandicap(fromTheHistory, player.handicap)` in
 * `astrosite/src/code/players.ts`, and for the reason `data-ownership.md` gives
 * beside it: nothing has written `player.handicap` since 2026-09-18, so a
 * stopgap that won would shadow a real reading until some unrelated job next
 * rewrote that player, which for the biographies run is a fortnight.
 *
 * This used to be an expression inside `Roster.astro`, in the other order, under
 * a comment claiming it was the site's. It was the site's *before* that
 * precedence was reversed. No player is in the state where the two orders differ
 * — every player with a stored handicap also had history, which is what made
 * removing the field a no-op — so it was a latent disagreement rather than a
 * wrong number on screen. It is still two implementations of one rule, and the
 * player pages needed the provenance anyway.
 */
export function resolveHandicap(
    player: Pick<Player, 'handicap'>,
    observed: PlayerHandicap | undefined
): ResolvedHandicap | undefined {
    if (observed) return { value: observed.handicap, source: 'observed', observed: observed.observed }
    if (player.handicap !== undefined) return { value: player.handicap, source: 'stopgap' }
    return undefined
}

/**
 * The handicap as a page prints it, with an em dash for a player nobody has a
 * figure for. `undefined` is a normal answer here — a new member WiseGolf has
 * not met, or a laptop whose emulator has no snapshot in it — so it is formatted
 * rather than guarded against at every call site.
 */
export function formatHandicap(resolved: ResolvedHandicap | undefined): string {
    return resolved === undefined ? '—' : String(resolved.value)
}
