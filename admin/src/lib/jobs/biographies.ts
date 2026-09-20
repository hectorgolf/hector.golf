import {
    biographiesToRegenerate,
    playerBiographyInput,
    type PlayerBiographyInput,
} from '@hector/schemas/src/biographies.ts'
import { hasParticipants } from '@hector/schemas/src/buckets.ts'
import { isoDate } from '@hector/schemas/src/dates.ts'
import { EventFormat, type Event, type HectorEvent } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import type { GolfClub } from '@hector/wisegolf/src/handicap-source-api.ts'

import { PLAYERS_ARE_OWNED } from '../ownership.ts'
import { backendFunctionsKey } from '../secrets.ts'
import { listEvents, listPlayers, savePlayer } from '../repository/events.ts'
import { CLUBS_PATH } from './clubs.ts'
import type { Change } from './log.ts'

/**
 * Regenerating player biographies, in this service rather than on a runner.
 *
 * The second and larger of the two writers step 1 of
 * `docs/plans/authoring-players-and-events.md` has to move, and the one the flip
 * is actually blocked on: `PLAYERS_ARE_OWNED` cannot go true while this job
 * still writes committed files, because the fortnightly rewrite would commit
 * over a record the next export publishes Firestore's version of.
 *
 * ## It generates now, and `PLAYERS_ARE_OWNED` is what holds it
 *
 * The decision half landed first and on its own, because it is the half that can
 * be wrong *silently*: a lock that stops being honoured looks exactly like a
 * lock that is working, until somebody's paragraph disappears a fortnight later.
 * That is what `biography-lock.test.ts` exists about.
 *
 * Generation is here too as of 2026-09-20, once the admin was given
 * `astrosite-api-key` to present to the function. It stays behind the ownership
 * flag rather than behind a `dryRun`, for the reason the club job's writer does:
 * two gates on one question means the flip is two edits, and one of them
 * eventually gets forgotten.
 *
 * A run before the flip therefore costs nothing. It works out who would be
 * rewritten and stops — no model call per player, no forty-five of them thrown
 * away to prove a list somebody can already read.
 *
 * ## The club name comes from `clubs.json`, not from WiseGolf
 *
 * The workflow resolves it by scraping the club list on every run. This reads
 * the committed file the `clubs` job maintains, which is one GitHub read against
 * 140 WiseGolf requests and a login — and is the reason that file was kept when
 * nothing else read it.
 *
 * ## Two outputs, not one
 *
 * `update-player-biographies.yml` also calls `refreshClubsJson()`, unconditionally
 * and before it checks whether there is anything to generate — so the workflow
 * cannot be deleted when this job takes the biographies over. `clubs.json` is
 * derived, has no human writer and nothing authors it, which
 * `data-ownership.md` describes as the arrangement where a file stays committed
 * and never joins the exported column. Whoever deletes the workflow has to give
 * that refresh a home first; `update-handicaps.yml` took four outputs to retire
 * and this one takes two.
 */

/** A Hector that has not started yet and has somebody in it. */
function upcomingHector(events: readonly HectorEvent[], now: Date): HectorEvent | undefined {
    const today = isoDate(now)
    return events
        .filter((event) => event.timing.start >= today)
        .filter(hasParticipants)
        .sort((a, b) => a.timing.start.localeCompare(b.timing.start))[0]
}

export type BiographyDependencies = {
    players: () => Promise<Player[]>
    events: () => Promise<Event[]>
    now: () => Date
    /** Whether the admin owns players yet; see the club job for the same gate. */
    playersAreOwned: () => boolean
    /** Abbreviation to full club name, for what the prompt calls `homeClub`. */
    clubs: () => Promise<GolfClub[]>
    /** One player's biography from the Cloud Function. Absent means no key. */
    generate?: (input: PlayerBiographyInput) => Promise<string[]>
    save: (player: Player, biography: string[]) => Promise<void>
}

export type BiographyJobResult = {
    outcome: 'ok' | 'failed' | 'skipped'
    detail?: string
    changes: Change[]
    commit?: string
}

const nameOf = (player: Player): string => `${player.name.first} ${player.name.last}`

/** The run log is read by people; "1 paragraphs" is how it stops being. */
const paragraphs = (count: number): string => `${count} ${count === 1 ? 'paragraph' : 'paragraphs'}`

export async function run(
    dependencies: BiographyDependencies,
    dryRun: boolean
): Promise<BiographyJobResult> {
    /*
     * The gate the workflow applies too, and it is the reason this job will do
     * nothing for most of the year: biographies are regenerated for an upcoming
     * Hector, so out of season there is no event to write for and the run is a
     * successful no-op rather than a failure.
     */
    const now = dependencies.now()
    const hectors = (await dependencies.events()).filter(
        (candidate): candidate is HectorEvent => candidate.format === EventFormat.Hector
    )
    const event = upcomingHector(hectors, now)
    if (!event) {
        return {
            outcome: 'ok',
            detail: 'No upcoming Hector with a field, so there is nothing to regenerate for.',
            changes: [],
        }
    }

    const { regenerate, locked, alreadyPublished } = biographiesToRegenerate(await dependencies.players())

    const held = locked.length === 0 ? '' : `; ${locked.length} left alone (${locked.map(nameOf).join(', ')})`
    const looked = `${event.id} is upcoming; ${regenerate.length} ${regenerate.length === 1 ? 'biography' : 'biographies'} to regenerate${held}`

    if (regenerate.length === 0) {
        return { outcome: 'ok', detail: `${looked}.`, changes: [] }
    }

    if (dryRun) {
        /*
         * No `Change` per player. A change claims a before and an after, and a
         * dry run has no after to name — inventing one would put a value in the
         * run log that was never produced.
         */
        return { outcome: 'ok', detail: `${looked}. Nothing was generated: this run decides only.`, changes: [] }
    }

    /*
     * The same gate as the club job's writer, and reported the same way.
     * `savePlayer` would refuse by throwing, which is right for a caller that
     * should not have asked — but a job running before the flip is not a
     * mistake, and it should not cost forty-five model calls to find that out.
     * So the check comes first, before a single one is made.
     */
    if (!dependencies.playersAreOwned()) {
        return {
            outcome: 'skipped',
            detail:
                `${looked}, but players are still mirrored. A biography written now would be ` +
                `reverted by the next seed, so nothing was generated; see PLAYERS_ARE_OWNED.`,
            changes: [],
        }
    }

    if (!dependencies.generate) {
        return {
            outcome: 'skipped',
            detail: `${looked}, but there is no key for the biography function; nothing was generated.`,
            changes: [],
        }
    }

    const clubNames = new Map((await dependencies.clubs()).map((club) => [club.abbreviation, club.name]))
    const today = isoDate(now)

    /*
     * Seeded with what the locked players already say, which is load-bearing
     * rather than tidy: a locked biography is still on the page beside
     * everything this run writes, so leaving it out lets the model echo a
     * published sentence under somebody else's name.
     */
    const published = [...alreadyPublished]
    const changes: Change[] = []

    for (const player of regenerate) {
        const input = playerBiographyInput(player, {
            hectorEvents: hectors,
            today,
            // "unknown" rather than an empty string, which is what the workflow
            // hands the prompt for a player with no club on record.
            homeClub: (player.club && clubNames.get(player.club)) || 'unknown',
            otherGeneratedBiographies: published,
        })

        let biography: string[]
        try {
            biography = await dependencies.generate(input)
        } catch (error) {
            /*
             * Stop rather than carry on. A generation failure is almost always
             * the key, the quota or the function being down — none of which the
             * next player will do better against — so continuing would spend
             * forty-four more calls to collect forty-four more copies of the
             * same error. What was written before it stays written, the same as
             * the workflow, and the detail says how far it got.
             */
            const reason = error instanceof Error ? error.message : String(error)
            return {
                outcome: 'failed',
                detail: `${looked}. Wrote ${changes.length} before ${nameOf(player)} failed: ${reason}`,
                changes,
            }
        }

        await dependencies.save(player, biography)
        changes.push({
            subject: player.id,
            from: paragraphs(player.biography?.length ?? 0),
            to: paragraphs(biography.length),
        })
        published.push(...biography)
    }

    return { outcome: 'ok', detail: `${looked}; rewrote ${changes.length}.`, changes }
}

/** Where `GeneratePlayerBiography` answers. Public to call, bearer-checked inside. */
export const BIOGRAPHY_FUNCTION = 'https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerBiography'

/** How this job signs its writes, in `updatedBy`. See the club job for why it matters. */
export const WRITTEN_BY = 'job:biographies'

/**
 * One biography from the Cloud Function.
 *
 * The response shape is checked before it is believed: the function answers 200
 * with a JSON body, and a body without a `biography` array is a failure that
 * would otherwise be saved as an empty biography over somebody's four
 * paragraphs. The workflow rejects on the same condition and this keeps it.
 */
async function callGenerator(input: PlayerBiographyInput, key: string): Promise<string[]> {
    const response = await fetch(BIOGRAPHY_FUNCTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(input),
    })

    if (!response.ok) {
        throw new Error(`the biography function answered ${response.status} ${response.statusText}`)
    }

    const body = (await response.json()) as { biography?: unknown }
    if (!Array.isArray(body.biography) || body.biography.some((p) => typeof p !== 'string')) {
        throw new Error('the biography function answered 200 without a biography')
    }
    return body.biography as string[]
}

/**
 * The club list, from the committed file rather than from WiseGolf.
 *
 * Tolerates both shapes because the file is mid-migration: a bare array until
 * the `clubs` job first runs, `{ fetchedAt, clubs }` after. `clubs.ts` treats a
 * stamp-less file the same way, and for the same reason.
 */
async function committedClubs(readFile: (path: string) => Promise<string | undefined>): Promise<GolfClub[]> {
    const text = await readFile(CLUBS_PATH)
    if (!text) return []
    const parsed = JSON.parse(text) as GolfClub[] | { clubs?: GolfClub[] }
    return Array.isArray(parsed) ? parsed : (parsed.clubs ?? [])
}

/**
 * The real dependencies, minus the `readFile` `registry.ts` supplies.
 *
 * Async because of the key, and the key is read here rather than inside
 * `generate` so that "there is no key" can be a missing dependency instead of a
 * thrown one. A job that cannot generate has not *failed* — a laptop has no key
 * and neither does a deployment on the day the secret is created — and the only
 * way to report that as a skip is to know it before the first player.
 *
 * Read per run rather than captured at module load, since this is called per
 * run: a deployment that is granted the secret, or has a version added to it,
 * starts working on the next run rather than on the next deploy.
 */
export async function live(
    readFile: (path: string) => Promise<string | undefined>
): Promise<BiographyDependencies> {
    const key = await backendFunctionsKey()

    return {
        players: listPlayers,
        events: listEvents,
        now: () => new Date(),
        playersAreOwned: () => PLAYERS_ARE_OWNED,
        clubs: () => committedClubs(readFile),
        generate: key ? (input) => callGenerator(input, key) : undefined,
        save: (player, biography) => savePlayer({ ...player, biography }, WRITTEN_BY),
    }
}
