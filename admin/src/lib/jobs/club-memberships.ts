import { createWisegolfSession } from '@hector/wisegolf/src/wisegolf-api.ts'
import { NullHandicapSource, type GolfClub, type HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { PLAYERS_ARE_OWNED } from '../ownership.ts'
import { listPlayers, savePlayer } from '../repository/events.ts'
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
 * it *would* assign — so a run's output can be compared against what
 * `update-player-club-memberships.yml` commits, and the two can be seen to agree
 * before either is switched off. The workflow keeps running throughout; that
 * overlap is what `registry.ts` means by a dataset appearing in both lists.
 *
 * **That comparison cannot produce a positive pairing, and waiting will not make
 * it.** The handicaps job's shadow period ended on one: it named a change
 * thirty-one seconds before the workflow committed the identical one. There is
 * no equivalent available here, because the only candidates are the four players
 * who have no club — and the run on 2026-09-20, the first to complete every
 * lookup without being throttled, established that WiseGolf cannot resolve any
 * of them. The workflow has been reaching the same conclusion monthly, which is
 * why they are still clubless.
 *
 * So the agreement on offer is the weak kind: both find nothing, for the same
 * reason, from the same data. What is left untested is the write path, and no
 * amount of further shadowing tests that.
 *
 * There is no writer here because *which store it writes* is a decision with a
 * plan attached rather than an implementation detail, and it is the next
 * commit's to make. Writing the committed file, the way the bucket recompute
 * does, keeps git the source and needs no ownership flip; writing Firestore
 * needs `PLAYERS_ARE_OWNED` and the biographies job moved first, or the next
 * seed reverts it. A live run without an `assign` is therefore `skipped` and
 * says so, rather than succeeding at nothing.
 *
 * ## A throttled lookup used to read as a negative one
 *
 * `findWisegolfPlayerClubs`
 * asks about a player once per club over all 140 of them, and `fetchPlayer`
 * returns `undefined` for any non-OK response — so "not a member of this club"
 * and "that request was rate-limited" are the same value. The first production
 * run, on 2026-09-20, drew an HTTP 429 doing exactly this.
 *
 * While the job only reports, the cost is a run that finds less than it should.
 * Once it writes, the harm changes shape: a player genuinely in two clubs, with
 * one of those lookups throttled, presents as a player in exactly one club — and
 * the ambiguity refusal below becomes an assignment. The rule would still be in
 * the code and would no longer be true.
 *
 * Fixed in the client on 2026-09-20: a scan that could not ask every club throws
 * `IncompleteLookupError` rather than reporting the clubs it managed to reach.
 * The per-source catch below turns that into "no club for this player this run",
 * which is the outcome that was wanted all along — so a run that reports nothing
 * now means nothing was found, and a run that could not tell says so in the log.
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
    /**
     * The record to write back with the club set.
     *
     * Carried on the assignment rather than looked up again by the writer,
     * because the roster this run decided against is the roster it should write:
     * re-reading would open a window where a player edited in between is
     * overwritten with what they looked like before this job started.
     */
    record: Player
}

export type ClubDependencies = {
    players: () => Promise<Player[]>
    sources: () => Promise<HandicapSource[]>
    /**
     * Whether the admin owns players yet, which decides whether a write is
     * possible at all rather than whether one is wanted.
     *
     * A dependency rather than reading `PLAYERS_ARE_OWNED` directly, so both
     * answers can be tested — the flag is false, and the path that runs the day
     * somebody flips it is the one with nobody looking at it.
     */
    playersAreOwned: () => boolean
    /** Where an assignment goes. Firestore, through `savePlayer`. */
    assign?: (assignments: readonly ClubAssignment[]) => Promise<void>
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
        if (club) {
            assignments.push({ player: player.id, name: nameOf(player), club, sources: agreed, record: player })
        }
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

    /*
     * Owned before written, and reported as a skip rather than a failure.
     *
     * `savePlayer` refuses a mirrored collection by throwing, which is right for
     * a caller that should not have asked — but a scheduled job is not a mistake
     * for running before the flip, and a run log full of red would say it was.
     * So the job asks first and says the true thing.
     */
    if (!dependencies.playersAreOwned()) {
        return {
            outcome: 'skipped',
            detail:
                `${looked} and found ${assignments.length}, but players are still mirrored. ` +
                `A club written now would be reverted by the next seed; see PLAYERS_ARE_OWNED.`,
            changes,
        }
    }

    if (!dependencies.assign) {
        return { outcome: 'skipped', detail: `${looked}, but this job has no writer.`, changes }
    }

    await dependencies.assign(assignments)
    return { outcome: 'ok', detail: `${looked}; assigned ${assignments.length}.`, changes }
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
export const LIVE: Pick<ClubDependencies, 'players' | 'sources' | 'playersAreOwned' | 'assign'> = {
    players: listPlayers,
    sources: async () => [await createWisegolfSession(await wisegolfCredentials())],
    playersAreOwned: () => PLAYERS_ARE_OWNED,
    /**
     * One `savePlayer` per assignment, in sequence.
     *
     * Not a batch, because there is no batch to be had: assignments are counted
     * in ones — four clubless players today, and the run that found them took
     * 151 seconds — so the cost of a round trip each is nothing against the
     * scrape that produced them.
     *
     * `WRITTEN_BY` is what `seed.ts` compares against: a player last written by
     * anything other than `seed` makes `--bootstrap` refuse, which is correct
     * once players are owned, because Firestore is then the only copy of this
     * club until somebody exports it.
     */
    assign: async (assignments) => {
        for (const assignment of assignments) {
            await savePlayer({ ...assignment.record, club: assignment.club.abbreviation }, WRITTEN_BY)
        }
    },
}

/** How this job signs its writes, in `updatedBy`. */
export const WRITTEN_BY = 'job:club-memberships'
