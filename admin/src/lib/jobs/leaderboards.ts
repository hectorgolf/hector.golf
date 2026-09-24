import { addDays, isoDate, type IsoDate } from '@hector/schemas/src/dates.ts'
import type { HectorEvent } from '@hector/schemas/src/events.ts'
import { serializeJson } from '@hector/schemas/src/json.ts'
import type { LeaderboardData } from '@hector/schemas/src/leaderboards/app-payload.ts'
import { splitCompetitorNames } from '@hector/schemas/src/leaderboards/names.ts'
import { isAppHectorGolfLeaderboard } from '@hector/schemas/src/leaderboards/sources.ts'
import { BOARD_SCORING } from '@hector/schemas/src/leaderboards/types.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { fetchStandings } from '../leaderboards/app.ts'
import { listPlayers } from '../repository/events.ts'
import { readHectorEvents, type StoredEvent } from './hector-events.ts'
import type { Change } from './log.ts'

/**
 * Refreshing the published standings of a tournament that is being played.
 *
 * ## Why this is a job and not the workflow it came from
 *
 * `update-leaderboards.yml` has always done this, and still does — for the events
 * whose standings live in a Google Sheet. What it cannot do is start when it is
 * told to. A GitHub run is dispatched, queued, given a runner, and made to
 * `npm ci` before it reads anything, which is minutes; and the thing being
 * published here changes every time somebody holes a putt.
 *
 * So the source that can say "a score just changed" gets an endpoint that does
 * the work in the request. `app.hector.golf` calls
 * `POST /api/jobs/leaderboards/run` and the board on hector.golf is a commit
 * behind rather than a workflow behind. The tick still runs it too, which is what
 * covers an update the push was never made for.
 *
 * ## Why it takes only the app.hector.golf events
 *
 * Because the sheet-sourced ones would cost a second credential and buy nothing.
 * Reading a Google Sheet needs `googleapis` and a service account the sheet has
 * been shared with; the workflow already has one, and no event that is being
 * played uses a sheet — the last two that did finished in 2024 and 2025. Moving
 * that path as well would mean writing it against no live event, which is how a
 * second untested writer for the same file appears.
 *
 * The split is by source rather than by schedule, and it is enforced on both
 * sides: this takes the events `isAppHectorGolfLeaderboard` matches, and the
 * workflow skips exactly those. One owner per event, so there is no race for the
 * file and no pair of commits undoing each other.
 *
 * ## Why it writes git rather than Firestore
 *
 * The same reason the bucket recompute does, and `buckets.ts` gives it at length:
 * Hector events and their leaderboards are read from the repository at build
 * time, and Firestore's copy of an event is a mirror. A scheduled writer against
 * the mirror races an unsynchronised export.
 */

/** Where the published standings live, one file per event. */
export const LEADERBOARDS_PATH = 'astrosite/src/data/leaderboards'

export type LeaderboardDependencies = {
    /** The files in a directory, as repository-relative paths. Throws if it cannot look. */
    listDirectory(path: string): Promise<string[]>
    /** A file's text, or undefined when it is not there. Throws if the read failed. */
    readFile(path: string): Promise<string | undefined>
    replace(
        path: string,
        text: string,
        message: string
    ): Promise<{ ok: true; commit: string } | { ok: false; detail: string }>
    /** The run's instant, asked for once so every file it writes carries the same one. */
    now(): Date
    /** Who the names on a leaderboard row might be. */
    players(): Promise<Player[]>
    /** The standings upstream is showing, or undefined when they could not be read. */
    standings(url: string): Promise<LeaderboardData | undefined>
}

export type JobResult = {
    outcome: 'ok' | 'failed'
    detail?: string
    changes: Change[]
    commit?: string
    /**
     * Always true when this job committed anything: everything it writes is under
     * `astrosite/`, which `deploy-site.yml` watches. See `publish()` in
     * `execute.ts` for why saying so matters.
     */
    deployStartsItself?: boolean
}

/**
 * What a leaderboard file holds.
 *
 * `updatedAt` is stamped on every write and is deliberately *not* part of what
 * decides whether to write: comparing the whole rendered file would make every
 * run a commit, which at a push per birdie is a repository nobody can read and a
 * site rebuilt for nothing. The boards are compared instead, and `updatedAt`
 * comes along when one of them moved — so it means "when the standings last
 * changed" rather than "when this job last ran", which is the more useful of the
 * two and the one the site already prints.
 */
type LeaderboardFile = {
    event: string
    scoring: typeof BOARD_SCORING
    hector: LeaderboardData['hector']
    victor: LeaderboardData['victor']
    updatedAt: string
}

/**
 * Whether an event is one this run should read.
 *
 * The rule is the workflow's, kept to the letter: an event that has not started
 * is skipped, and one that ended before yesterday is skipped. The day of grace at
 * the end is what lets a final round that finished late still be published the
 * next morning.
 */
export function isBeingPlayed(event: Pick<HectorEvent, 'timing'>, today: IsoDate): boolean {
    if (event.timing.start > today) return false
    if (event.timing.end < addDays(today, -1)) return false
    return true
}

/** The events this run is responsible for: being played, and sourced from the app. */
export function eventsToUpdate(stored: readonly StoredEvent[], today: IsoDate): StoredEvent[] {
    return stored.filter(
        (entry) => isAppHectorGolfLeaderboard(entry.event.leaderboardSheet) && isBeingPlayed(entry.event, today)
    )
}

/** The boards, as they would be compared. Everything else about the file is stamped. */
const boardsOf = (file: { hector?: unknown; victor?: unknown }) =>
    JSON.stringify({ hector: file.hector ?? [], victor: file.victor ?? [] })

/**
 * A player id for a name off a leaderboard row, or undefined for a stranger.
 *
 * Matched against a player's own name and any alias, case-insensitively, because
 * that is how the pairings have always been resolved and the rows are typed by
 * whoever is running the tournament. An unmatched name is not an error here —
 * `pairingsFrom` refuses the whole event rather than guessing at one seat.
 */
export function playerIdByName(players: readonly Player[], name: string): string | undefined {
    const wanted = name.trim().toLowerCase()
    return players.find((player) =>
        [player.name, ...(player.aliases ?? [])].some(
            (candidate) => `${candidate.first} ${candidate.last}`.toLowerCase() === wanted
        )
    )?.id
}

export type Pairings = Array<{ name: string; players: string[] }>

/**
 * The teams a leaderboard is showing, or undefined when it is not showing them.
 *
 * All or nothing, on purpose. A pairing that resolved for eleven teams and not
 * the twelfth is a `results.teams` that is quietly missing a pair, which reads as
 * a team that withdrew rather than as a name this service did not recognise. The
 * next run will resolve it once the name is fixed at either end.
 */
export function pairingsFrom(hector: LeaderboardData['hector'], players: readonly Player[]): Pairings | undefined {
    if (hector.length === 0) return undefined
    // Before the draw, the rows carry scores and no names. There is nothing to
    // learn from them yet, and the event file's empty `teams` is correct.
    if (!hector.every((row) => row.team && row.team.trim().length > 0)) return undefined

    const teams: Pairings = []
    for (const row of hector) {
        const names = splitCompetitorNames(row.team)
        const ids = names.map((name) => playerIdByName(players, name))
        if (ids.some((id) => id === undefined)) {
            console.log('Not taking the pairings from this leaderboard yet: a name on it matches no player', {
                team: row.team,
                unmatched: names.filter((_, index) => ids[index] === undefined),
            })
            return undefined
        }
        teams.push({ name: row.team, players: ids as string[] })
    }
    return teams
}

/**
 * One run: every event being played, read from upstream and published.
 *
 * An event that cannot be read does not stop the others and does not blank its
 * own board — it leaves the committed file alone and makes the run fail, which is
 * both what the caller needs to hear and what puts a line on the Operations page.
 */
export async function run(dependencies: LeaderboardDependencies, dryRun: boolean): Promise<JobResult> {
    const now = dependencies.now()
    const today = isoDate(now)
    const events = eventsToUpdate(await readHectorEvents(dependencies), today)

    if (events.length === 0) {
        // Not a failure, and the common case: this is a job about tournaments in
        // progress, and there are none for fifty weeks of the year.
        return { outcome: 'ok', detail: 'no tournament on app.hector.golf is being played today', changes: [] }
    }

    const changes: Change[] = []
    const failures: string[] = []
    let committed = 0
    let commit: string | undefined
    let players: Player[] | undefined

    for (const entry of events) {
        const event = entry.event
        const standings = await dependencies.standings(event.leaderboardSheet!)
        if (!standings) {
            failures.push(`could not read the standings for ${event.id} from app.hector.golf`)
            continue
        }

        // The boards first, then the pairings they may have taught us. Both are
        // writes to `astrosite/`, so neither has to ask for a deploy.
        const board = await publishBoards(dependencies, entry, standings, now, dryRun)
        if (board.failure) failures.push(board.failure)
        if (board.change) changes.push(board.change)
        if (board.commit) {
            committed += 1
            commit = board.commit
        }

        if ((event.results?.teams ?? []).length > 0) continue

        // Read once, and only for an event that might need them. Forty-six
        // documents against a job that usually has nothing to learn.
        players ??= await dependencies.players()
        const teams = pairingsFrom(standings.hector, players)
        if (!teams) continue

        const pairing = await publishPairings(dependencies, entry, teams, dryRun)
        if (pairing.failure) failures.push(pairing.failure)
        if (pairing.change) changes.push(pairing.change)
        if (pairing.commit) {
            committed += 1
            commit = pairing.commit
        }
    }

    if (failures.length > 0) {
        return {
            outcome: 'failed',
            detail: failures.join('; '),
            changes,
            commit,
            deployStartsItself: committed > 0,
        }
    }

    return {
        outcome: 'ok',
        // Said out loud, because "ok, nothing changed" and "ok, nothing was
        // read" are the same empty result to anybody scanning the run log, and
        // only one of them is the job working. Decided on the changes rather
        // than on the commits, so a shadow run does not report a board it just
        // said had moved as unchanged.
        detail:
            changes.length === 0
                ? `the standings for ${events.map((entry) => entry.event.id).join(', ')} are unchanged`
                : undefined,
        changes,
        commit,
        deployStartsItself: committed > 0,
    }
}

type Written = { change?: Change; commit?: string; failure?: string }

/** Publish one event's boards, unless they say the same as what is committed. */
async function publishBoards(
    dependencies: LeaderboardDependencies,
    entry: StoredEvent,
    standings: LeaderboardData,
    now: Date,
    dryRun: boolean
): Promise<Written> {
    const event = entry.event
    const path = `${LEADERBOARDS_PATH}/${event.id}.json`
    const existing = await dependencies.readFile(path)

    let before: { hector?: unknown; victor?: unknown } = {}
    if (existing !== undefined) {
        try {
            before = JSON.parse(existing)
        } catch (error) {
            // Refused rather than overwritten. A leaderboard file that does not
            // parse is a file something else is in the middle of writing, or one
            // a human is repairing, and neither wants a robot on top of it.
            return { failure: `${path} is not valid JSON, so ${event.id} was left alone: ${String(error)}` }
        }
    }

    const wasShowing = boardsOf(before)
    const isShowing = boardsOf(standings)
    if (wasShowing === isShowing) return {}

    const change: Change = {
        subject: event.id,
        from: existing === undefined ? undefined : summarise(before),
        to: summarise(standings),
    }

    if (dryRun) {
        console.log(`Shadow run: ${path} would be rewritten`, { from: change.from, to: change.to })
        return { change }
    }

    const file: LeaderboardFile = {
        event: event.id,
        // Read from one definition rather than restated, because the rows were
        // signed by the same fact and the two disagreeing would print every gap
        // backwards.
        scoring: BOARD_SCORING,
        hector: standings.hector,
        victor: standings.victor,
        updatedAt: now.toISOString(),
    }

    // The message the workflow has always used, so that `git log` reads as one
    // history across the handover rather than as two.
    const written = await dependencies.replace(
        path,
        serializeJson(file),
        `Automated leaderboard update for ${event.id} at ${file.updatedAt}`
    )
    if (!written.ok) return { change, failure: written.detail }
    return { change, commit: written.commit === 'unchanged' ? undefined : written.commit }
}

/** Write the pairings into the event file, the first time the board shows them. */
async function publishPairings(
    dependencies: LeaderboardDependencies,
    entry: StoredEvent,
    teams: Pairings,
    dryRun: boolean
): Promise<Written> {
    const event = entry.event
    const winners = event.results?.winners ?? { hector: [], victor: [] }
    const rendered = serializeJson({ ...entry.json, results: { teams, winners } })
    if (rendered === entry.raw) return {}

    const change: Change = {
        subject: `${event.id} pairings`,
        from: `${(event.results?.teams ?? []).length} teams`,
        to: `${teams.length} teams`,
    }

    if (dryRun) {
        console.log(`Shadow run: ${entry.path} would gain ${teams.length} teams from the live leaderboard`)
        return { change }
    }

    const written = await dependencies.replace(
        entry.path,
        rendered,
        `Record the pairings for ${event.id} from the live leaderboard`
    )
    if (!written.ok) return { change, failure: written.detail }
    return { change, commit: written.commit === 'unchanged' ? undefined : written.commit }
}

/**
 * A board in one line, for the run log.
 *
 * The leader and the size of the field, because that is what somebody scanning
 * the log is checking: that the run published a board with somebody on top of it
 * rather than an empty one. The whole board is in the commit.
 */
function summarise(board: { hector?: unknown; victor?: unknown }): string {
    const hector = Array.isArray(board.hector) ? board.hector : []
    const victor = Array.isArray(board.victor) ? board.victor : []
    const leader = (rows: unknown[], key: 'team' | 'player'): string => {
        const first = rows[0] as Record<string, unknown> | undefined
        return first && typeof first[key] === 'string' ? (first[key] as string) : '—'
    }
    return `Hector ${hector.length} (${leader(hector, 'team')}), Victor ${victor.length} (${leader(victor, 'player')})`
}

/**
 * The real app.hector.golf and Firestore, as `run` sees them.
 *
 * `registry.ts` spreads this beside the GitHub and clock seams it builds itself,
 * exactly as it does for the handicaps job, and the tests pass their own.
 */
export const LIVE: Pick<LeaderboardDependencies, 'players' | 'standings'> = {
    players: listPlayers,
    standings: fetchStandings,
}
