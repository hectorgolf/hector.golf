import { biographiesToRegenerate } from '@hector/schemas/src/biographies.ts'
import { hasParticipants } from '@hector/schemas/src/buckets.ts'
import { isoDate } from '@hector/schemas/src/dates.ts'
import { EventFormat, type Event, type HectorEvent } from '@hector/schemas/src/events.ts'
import type { Player } from '@hector/schemas/src/players.ts'

import { listEvents, listPlayers } from '../repository/events.ts'
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
 * ## What this slice does, and what it leaves
 *
 * It decides, and it does not generate. Reading the roster out of Firestore,
 * finding whether a Hector is upcoming, and working out who would be rewritten
 * and who a lock is holding — all of that runs here now and is reported. Calling
 * `GeneratePlayerBiography` is not.
 *
 * That split is deliberate rather than half-finished. The decision is the half
 * that can be wrong *silently*: a lock that stops being honoured looks exactly
 * like a lock that is working until somebody's paragraph disappears a fortnight
 * later, which is the failure `biography-lock.test.ts` exists about. The
 * generation half fails loudly — an HTTP call either reaches the function or
 * does not — and it is the half that costs a Gemini call per player per run,
 * forty-five of them, thrown away every time while the job writes nothing.
 *
 * So a live run without a `generate` is `skipped` and says so, the same as the
 * club job. What a writer should target is the same open question, and it has
 * the same answer pending: Firestore, once this job and the club one have both
 * stopped writing files.
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
function upcomingHector(events: readonly Event[], now: Date): HectorEvent | undefined {
    const today = isoDate(now)
    return events
        .filter((event): event is HectorEvent => event.format === EventFormat.Hector)
        .filter((event) => event.timing.start >= today)
        .filter(hasParticipants)
        .sort((a, b) => a.timing.start.localeCompare(b.timing.start))[0]
}

export type BiographyDependencies = {
    players: () => Promise<Player[]>
    events: () => Promise<Event[]>
    now: () => Date
    /**
     * Absent until the writer is decided, which makes a live run refuse rather
     * than quietly do nothing. It takes the whole selection because generation
     * is not independent per player: each biography is produced partly from the
     * others in the same run, and from what the locked ones already say.
     */
    generate?: (
        regenerate: readonly Player[],
        alreadyPublished: readonly string[]
    ) => Promise<{ changes: Change[]; commit?: string }>
}

export type BiographyJobResult = {
    outcome: 'ok' | 'failed' | 'skipped'
    detail?: string
    changes: Change[]
    commit?: string
}

const nameOf = (player: Player): string => `${player.name.first} ${player.name.last}`

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
    const event = upcomingHector(await dependencies.events(), dependencies.now())
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
         * No `Change` per player, deliberately. A change claims a before and an
         * after, and this slice does not generate — so it has no after to name,
         * and inventing one would put a value in the run log that was never
         * produced. The count is in the detail, where it is honest.
         */
        return { outcome: 'ok', detail: `${looked}. Nothing was generated: this run decides only.`, changes: [] }
    }

    if (!dependencies.generate) {
        return {
            outcome: 'skipped',
            detail: `${looked}, but this job has no generator yet. See the module header.`,
            changes: [],
        }
    }

    const { changes, commit } = await dependencies.generate(regenerate, alreadyPublished)
    return { outcome: 'ok', detail: `${looked}.`, changes, commit }
}

/** The real dependencies; `registry.ts` supplies nothing else this job needs. */
export const LIVE: Pick<BiographyDependencies, 'players' | 'events' | 'now'> = {
    players: listPlayers,
    events: listEvents,
    now: () => new Date(),
}
