import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import { latestPerDay } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import type { HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import { createWisegolfSession } from '@hector/wisegolf/src/wisegolf-api.ts'

import { all, insertMissing, parse, render } from '../handicaps/observations.ts'
import { listPlayers } from '../repository/events.ts'
import { wisegolfCredentials } from '../secrets.ts'
import type { Change } from './log.ts'

/**
 * Reading every player's handicap, and keeping three stores agreeing about it.
 *
 * This is the first job to move off a GitHub Actions runner and into the
 * service. `docs/plans/handicaps-to-firestore.md` is the plan it implements and
 * explains the order; what follows is the part that is easier to get wrong than
 * to read.
 */

/**
 * Where the backup lives, during the transition.
 *
 * Still under `astrosite/src/data/` for now, which has two consequences worth
 * knowing about while step 2 of the plan is running. It is inside
 * `deploy-site.yml`'s path filter, and a commit made with this service's token
 * *does* trigger workflows — unlike one made with `GITHUB_TOKEN`, whose
 * recursion guard is the whole reason `.github/actions/request-deploy` exists —
 * so each commit here publishes the site by itself. And it is inside the tree
 * `.prettierignore` already covers, so nothing reformats it.
 *
 * Step 3 moves it to `data/handicaps/observations.ndjson`, out of both.
 */
export const BACKUP_PATH = 'astrosite/src/data/handicaps.ndjson'

/** Where the old pipeline's output is read from, for the reconcile. */
export const LEGACY_PATH = 'astrosite/src/data/handicaps.json'

/**
 * Today, as the entries mean it.
 *
 * `date` is the day we *saw* the value, not the day the Golf Union computed it —
 * the gap between those is what `observed` exists to record. Cloud Run runs UTC
 * and so did the runner this moved off, so the answer is unchanged by the move.
 */
export const isoDateToday = (now: Date): string => now.toISOString().slice(0, 10)

/** To the second, matching what `isoInstantNow` writes in the workflow. */
export const isoInstantNow = (now: Date): string => `${now.toISOString().slice(0, 19)}Z`

/**
 * The part of a `HandicapSource` this job uses.
 *
 * Narrower than the interface on purpose. A source also knows how to resolve a
 * club membership and list clubs, which are what the *other* two WiseGolf
 * scrapes want; demanding them here would mean a caller — or a test — has to
 * supply behaviour this function never reaches.
 */
export type HandicapReader = Pick<HandicapSource, 'name' | 'getPlayerHandicap'>

export type ScrapeResult = {
    /** Every player a source answered for, and what it said. */
    readings: Map<string, number>
    /** Players no source answered for. */
    skipped: string[]
}

/**
 * Ask the sources for every player's handicap.
 *
 * Separated from the deciding below so that the decision is testable without
 * standing in for the network, which is the same seam `fetchUpdatedPlayerRecords`
 * already draws in the workflow this replaces.
 *
 * A player with no club is skipped rather than attempted: the sources key on
 * club, and `update-player-club-memberships` is what fills that field.
 */
export async function scrape(players: readonly Player[], sources: readonly HandicapReader[]): Promise<ScrapeResult> {
    const readings = new Map<string, number>()
    const skipped: string[] = []

    await Promise.all(
        players.map(async (player) => {
            if (!player.club) {
                skipped.push(player.id)
                return
            }
            for (const source of sources) {
                try {
                    const handicap = await source.getPlayerHandicap(player.name.first, player.name.last, player.club)
                    if (handicap !== undefined) {
                        readings.set(player.id, handicap)
                        return
                    }
                } catch (error) {
                    console.error(`Could not read a handicap from ${source.name}`, { player: player.id }, error)
                }
            }
            skipped.push(player.id)
        })
    )

    return { readings, skipped }
}

/**
 * What the scrape found that we did not already hold.
 *
 * Compared against the *daily* view rather than the raw log, which matters on a
 * day that already holds a reading: `latestPerDay` is what the site shows, so it
 * is what "unchanged" has to mean. Comparing against the last raw entry instead
 * would re-record this morning's value every afternoon on any day the Union
 * published twice.
 */
export function decide(
    history: readonly HandicapHistoryEntry[],
    readings: ReadonlyMap<string, number>,
    now: Date
): { entries: HandicapHistoryEntry[]; changes: Change[] } {
    const date = isoDateToday(now)
    const observed = isoInstantNow(now)

    const held = new Map<string, number>()
    for (const entry of latestPerDay(history)) held.set(entry.player, entry.handicap)

    const entries: HandicapHistoryEntry[] = []
    const changes: Change[] = []

    // Sorted, so that a run's output does not depend on Map iteration order. The
    // rendered file is sorted anyway, but the run log and the commit message are
    // read by people and should not shuffle between runs.
    for (const player of [...readings.keys()].sort()) {
        const handicap = readings.get(player)!
        const previous = held.get(player)
        if (previous === handicap) continue

        entries.push({ date, player, handicap, observed })
        changes.push({
            subject: player,
            from: previous === undefined ? undefined : String(previous),
            to: String(handicap),
        })
    }

    return { entries, changes }
}

export type JobDependencies = {
    readFile(path: string): Promise<string | undefined>
    commit(path: string, text: string, message: string): Promise<{ ok: true; commit: string } | { ok: false; detail: string }>
    now(): Date
}

export type JobResult = {
    outcome: 'ok' | 'failed'
    detail?: string
    changes: Change[]
    commit?: string
}

/**
 * One run of the handicaps job.
 *
 * The order is the plan's, and the two places it looks redundant are the two
 * places it is not:
 *
 * **The reconcile runs first, every time.** Not only on the first run. While the
 * old workflow is still writing `handicaps.json`, this is how its rows reach
 * Firestore; afterwards it is a cheap no-op that also happens to repair a
 * Firestore that lost a write.
 *
 * **The commit is decided by comparing, not by counting.** The tempting version
 * — "if this run found changes, append them" — fails silently: a run that writes
 * Firestore and then dies before committing leaves the stores apart, and the
 * next run finds no changes and never repairs it. Rendering the whole file and
 * comparing it to what is committed is self-healing, and makes a retried tick
 * free rather than dangerous.
 */
export async function run(dependencies: JobDependencies, dryRun: boolean): Promise<JobResult> {
    const now = dependencies.now()

    // 1. Bring Firestore up to date with whatever the old pipeline committed.
    const legacy = await dependencies.readFile(LEGACY_PATH)
    if (legacy !== undefined) {
        const committed = JSON.parse(legacy) as HandicapHistoryEntry[]
        const inserted = dryRun ? [] : await insertMissing(committed)
        if (inserted.length > 0) {
            console.log(`Reconciled ${inserted.length} observations from ${LEGACY_PATH} into Firestore`)
        }
    }

    // 2. Read the handicaps.
    const players = await listPlayers()
    const credentials = await wisegolfCredentials()
    const session = await createWisegolfSession(credentials)
    const { readings, skipped } = await scrape(players, [session])

    if (readings.size === 0) {
        // Not a failure, and deliberately not a commit either. A sweep that
        // reached nobody has nothing to attest to: the sources are down or the
        // login is wrong, and recording it would mean publishing a run that
        // learned nothing. The same judgement `sweepOf` makes in the workflow.
        return {
            outcome: 'failed',
            detail: `no handicap source answered for any of ${players.length} players`,
            changes: [],
        }
    }
    if (skipped.length > 0) {
        console.log(`No source answered for ${skipped.length} of ${players.length} players`, { skipped })
    }

    // 3. Decide what is new, against what Firestore holds.
    const history = await all()
    const { entries, changes } = decide(history, readings, now)

    if (dryRun) {
        // The entire output of a shadow run: what it would have done, in the run
        // log and in Cloud Logging, having touched neither store.
        //
        // The changes are serialised onto the one line rather than passed as a
        // second argument the way the rest of this service logs objects. That
        // form is nicer to read locally and wrong here: Node pretty-prints an
        // array of 45 objects across dozens of lines, and Cloud Run's logging
        // agent makes a separate log entry out of every line it reads from
        // stdout — so the one thing worth reading arrives shredded, and a filter
        // matching "Shadow run" returns the sentence without the evidence.
        console.log(
            `Shadow run: ${changes.length} observation(s) would have been written: ${JSON.stringify(changes)}`
        )
        return { outcome: 'ok', changes }
    }

    // 4. Write them.
    if (entries.length > 0) await insertMissing(entries)

    // 5. Render everything and commit if the result differs from what is there.
    const rendered = render(await all())
    const message =
        changes.length > 0
            ? `Update ${changes.length} ${changes.length === 1 ? "player's" : "players'"} handicap`
            : 'Reconcile the handicap observation log'
    const committed = await dependencies.commit(BACKUP_PATH, rendered, message)

    return committed.ok
        ? { outcome: 'ok', changes, commit: committed.commit }
        : { outcome: 'failed', detail: committed.detail, changes }
}

/** Re-exported for the tests, which pin the backup's shape rather than the write. */
export { parse, render }
