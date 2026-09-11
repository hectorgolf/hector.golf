import type { Player } from '@hector/schemas/src/players.ts'

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
