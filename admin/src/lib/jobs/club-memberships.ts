import { createWisegolfSession } from '@hector/wisegolf/src/wisegolf-api.ts'
import { NullHandicapSource, type GolfClub, type HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { listPlayers } from '../repository/events.ts'
import { wisegolfCredentials } from '../secrets.ts'
import type { Change } from './log.ts'

/**
 * Finding a player's home club, in this service rather than on a runner.
 *
 * The first of the two writers step 1 of `docs/plans/authoring-players-and-events.md`
 * has to move — `update-player-club-memberships`, which scrapes WiseGolf for a
 * club to put on a player who has none. It is the smaller of the pair by some
 * distance, which is why it goes first: the biographies job calls a Cloud
 * Function and rewrites prose, this one reads a name and writes an
 * abbreviation.
 *
 * ## It writes nothing yet, and refuses to pretend otherwise
 *
 * This lands in shadow, the way the handicap scrape did. It reads players out of
 * Firestore, asks WiseGolf the same question the workflow asks, and reports what
 * it *would* assign — so a tick's output can be compared against what
 * `update-player-club-memberships.yml` commits, and the two can be seen to agree
 * before either is switched off. The workflow keeps running throughout; that
 * overlap is what `registry.ts` means by a dataset appearing in both lists.
 *
 * There is no writer here because *which store it writes* is a decision with a
 * plan attached rather than an implementation detail, and it is the next
 * commit's to make. Writing the committed file, the way the bucket recompute
 * does, keeps git the source and needs no ownership flip; writing Firestore
 * needs `PLAYERS_ARE_OWNED` and the biographies job moved first, or the next
 * seed reverts it. A live run without an `assign` is therefore `skipped` and
 * says so, rather than succeeding at nothing.
 *
 * ## The rule it implements does not change
 *
 * Assign a club only to a player who has none, and only when exactly one club
 * matches. `data-ownership.md` classes `club` as authored — CI fills it only
 * when empty and never overwrites — and that rule was arrived at independently
 * in the workflow because it was obviously right for the field. It is carried
 * over here unchanged, including the ambiguity refusal: two clubs with a member
 * of that name is not a reason to guess.
 */

/** A club this run would put on a player who has none. */
export type ClubAssignment = {
    player: string
    name: string
    club: GolfClub
    /** Which sources agreed, for a run log somebody is reading later. */
    sources: string[]
}

export type ClubDependencies = {
    players: () => Promise<Player[]>
    sources: () => Promise<HandicapSource[]>
    /**
     * Where an assignment goes, once that is decided. Absent today, which is
     * what makes a live run refuse rather than quietly do nothing.
     */
    assign?: (assignments: readonly ClubAssignment[]) => Promise<{ commit?: string }>
}

export type ClubJobResult = {
    outcome: 'ok' | 'failed' | 'skipped'
    detail?: string
    changes: Change[]
    commit?: string
}

/** Full name, as the log prints it. Players are never privacy-shortened here. */
const nameOf = (player: Player): string => `${player.name.first} ${player.name.last}`

/**
 * The sources that can actually answer, which is not all of them.
 *
 * `createWisegolfSession` never throws for a missing credential — it warns and
 * hands back a `NullHandicapSource`, deliberately, so that a site build on a
 * laptop finds nothing rather than crashing. That is the right call for a build
 * and the wrong one for a run log: a null source answers "no clubs" to every
 * question, which is indistinguishable from a real scrape finding nobody, and
 * the Operations page would show a confident green tick for a job that asked
 * nothing.
 *
 * So the disabled ones are filtered out and an empty result is a `skipped` run.
 * `instanceof` rather than matching the " (disabled)" the constructor appends to
 * the name, because one of those is an API and the other is a log string.
 */
const usable = (sources: readonly HandicapSource[]): HandicapSource[] =>
    sources.filter((source) => !(source instanceof NullHandicapSource))

/**
 * The one club every source agrees on, or nothing.
 *
 * Deduplicated **by abbreviation**, which the workflow does not do: it builds
 * `[...new Set(clubs)]` over objects, and two sources returning the same club as
 * two objects are two distinct set members. With one source that is unreachable,
 * and WiseGolf is the only source today — but the shape of the code says
 * "several sources" and the next one added would have made a player found at one
 * club look ambiguous. Fixing it here costs a line and removes a trap from the
 * version that survives.
 */
export function agreedClub(found: readonly GolfClub[]): GolfClub | undefined {
    const byAbbreviation = new Map(found.map((club) => [club.abbreviation, club]))
    return byAbbreviation.size === 1 ? [...byAbbreviation.values()][0] : undefined
}

/**
 * What this run would assign, asking every source about every clubless player.
 *
 * A source that throws for one player costs that player and not the run. The
 * workflow catches per player for the same reason, and the reason is that
 * WiseGolf answers about forty-five names one at a time: a single timeout should
 * not discard the other forty-four answers.
 */
async function resolve(
    players: readonly Player[],
    sources: readonly HandicapSource[]
): Promise<ClubAssignment[]> {
    const assignments: ClubAssignment[] = []

    for (const player of players) {
        const found: GolfClub[] = []
        const agreed: string[] = []

        for (const source of sources) {
            try {
                const clubs = await source.resolveClubMembership(player.name.first, player.name.last)
                if (clubs.length > 0) agreed.push(source.name)
                found.push(...clubs)
            } catch (error) {
                console.error(`Could not ask ${source.name} about ${nameOf(player)}:`, error)
            }
        }

        const club = agreedClub(found)
        if (club) assignments.push({ player: player.id, name: nameOf(player), club, sources: agreed })
    }

    return assignments
}

export async function run(dependencies: ClubDependencies, dryRun: boolean): Promise<ClubJobResult> {
    const players = await dependencies.players()
    const clubless = players.filter((player) => !player.club)

    // Not a no-op worth reporting as a change: every player having a club is the
    // normal state of this collection, and it is what four of forty-five being
    // clubless today will become.
    if (clubless.length === 0) {
        return { outcome: 'ok', detail: 'Every player has a club on record.', changes: [] }
    }

    const sources = usable(await dependencies.sources())
    if (sources.length === 0) {
        return {
            outcome: 'skipped',
            detail: 'No handicap source is configured, so nothing was asked.',
            changes: [],
        }
    }

    const assignments = await resolve(clubless, sources)
    const changes: Change[] = assignments.map((assignment) => ({
        subject: assignment.player,
        from: undefined,
        to: assignment.club.abbreviation,
    }))

    const looked = `Looked for a club for ${clubless.length} ${clubless.length === 1 ? 'player' : 'players'}`

    if (assignments.length === 0) {
        return { outcome: 'ok', detail: `${looked}; no club matched exactly one.`, changes: [] }
    }

    if (dryRun) {
        const found = assignments.map((a) => `${a.name} → ${a.club.abbreviation} (${a.club.name})`)
        return { outcome: 'ok', detail: `${looked}; would assign ${found.join(', ')}.`, changes }
    }

    if (!dependencies.assign) {
        return {
            outcome: 'skipped',
            detail:
                `${looked} and found ${assignments.length}, but this job has no writer yet. ` +
                `Where a club is written is step 1's next decision; see the module header.`,
            changes,
        }
    }

    const { commit } = await dependencies.assign(assignments)
    return { outcome: 'ok', detail: `${looked}; assigned ${assignments.length}.`, changes, commit }
}

/**
 * The real dependencies, built the way the handicaps job builds its own.
 *
 * The session is created whether or not there are credentials, which matters on
 * a laptop: `createWisegolfSession` looks for `WISEGOLF_STAND_IN_ROSTER` *before*
 * the credentials, so `npm run dev:fake` gets the drifting stand-in and refusing
 * to construct a session without credentials would have locked it out. What a
 * missing credential produces is a `NullHandicapSource`, which `usable` above
 * takes back out.
 */
export const LIVE: Pick<ClubDependencies, 'players' | 'sources'> = {
    players: listPlayers,
    sources: async () => [await createWisegolfSession(await wisegolfCredentials())],
}
