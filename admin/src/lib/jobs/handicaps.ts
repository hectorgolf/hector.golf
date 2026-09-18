import type { HandicapHistoryEntry } from '@hector/schemas/src/handicaps.ts'
import { latestPerDay } from '@hector/schemas/src/handicaps.ts'
import type { Player } from '@hector/schemas/src/players.ts'
import type { HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import { createWisegolfSession } from '@hector/wisegolf/src/wisegolf-api.ts'

import type { HandicapCheck } from '@hector/schemas/src/handicap-checks.ts'

import {
    all as allChecks,
    insert as insertChecks,
    missingFrom as checksMissingFrom,
    parse as parseChecks,
    render as renderChecks,
} from '../handicaps/checks.ts'
import { all, insert, missingFrom, parse, render } from '../handicaps/observations.ts'
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
 * Where the backup lives.
 *
 * Outside `astrosite/`, and that is the whole point of the location rather than
 * tidiness. `deploy-site.yml` and `check-site.yml` both filter on
 * `astrosite/**`, and a commit made with this service's token *does* trigger
 * workflows — unlike one made with `GITHUB_TOKEN`, whose recursion guard is the
 * entire reason `.github/actions/request-deploy` exists. A backup kept inside
 * that tree would therefore publish the site every time it was written, twice
 * per change once the reconcile round is counted, for a file nothing builds
 * from.
 *
 * The plan had this move in step 3, alongside the reader. It happens here
 * instead because the file did not exist yet when step 2 began: moving a path
 * before anything is committed to it costs nothing, where moving it afterwards
 * means a committed file to migrate and an append-only guard looking at the
 * wrong history.
 *
 * The cost of leaving `astrosite/src/data/` is that `.prettierignore` no longer
 * covers this by accident, so it names the file directly. Prettier cannot infer
 * a parser for `.ndjson` and *errors* rather than reformatting, so without that
 * entry a repository-wide `prettier --check` fails rather than merely churning.
 */
export const BACKUP_PATH = 'data/handicaps/observations.ndjson'

/**
 * Where the sweep log's backup lives.
 *
 * Beside the observation log and for the same reasons: outside `astrosite/` so
 * that committing it does not publish the site, and NDJSON so that the
 * append-only guard — which is line-oriented — can actually guard it.
 */
export const CHECKS_BACKUP_PATH = 'data/handicaps/checks.ndjson'

/** Where the old pipeline's sweep log is read from, for the reconcile. */
export const LEGACY_CHECKS_PATH = 'astrosite/src/data/handicap-checks.json'

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

    // The one read of the observation log, reused for every decision below.
    //
    // It used to be four — two here and two inside a writer that re-read the
    // collection to find out what was missing. At 1,400 observations and four
    // runs a day that was 23,000 document reads against a free tier of 50,000,
    // growing with a log that is never pruned. Reading once costs a quarter of
    // that and stops the allowance being a deadline.
    const stored = await all()

    // 1. Bring both stores up to date with whatever the old pipeline committed.
    const legacy = await dependencies.readFile(LEGACY_PATH)
    const committed: HandicapHistoryEntry[] = legacy === undefined ? [] : JSON.parse(legacy)
    const missing = missingFrom(stored, committed)

    if (!dryRun && missing.length > 0) {
        await insert(missing)
        console.log(`Reconciled ${missing.length} observations from ${LEGACY_PATH} into the store`)
    }

    /*
     * The sweep log gets the same treatment, and it is worth saying why it is a
     * second reconcile rather than a second job.
     *
     * A check records *this* scrape — who answered and who did not — so it can
     * only be written by whatever did the scraping. A separate job would have to
     * sweep WiseGolf again to have anything to say, which is a second sweep per
     * tick for a record of the first one. One scrape, two outputs, the way the
     * workflow this replaces has always done it.
     */
    const storedChecks = await allChecks()
    const legacyChecks = await dependencies.readFile(LEGACY_CHECKS_PATH)
    const committedChecks: HandicapCheck[] = legacyChecks === undefined ? [] : JSON.parse(legacyChecks)
    const missingChecks = checksMissingFrom(storedChecks, committedChecks)

    if (!dryRun && missingChecks.length > 0) {
        await insertChecks(missingChecks)
        console.log(`Reconciled ${missingChecks.length} sweeps from ${LEGACY_CHECKS_PATH} into the store`)
    }

    const checkHistory = [...storedChecks, ...missingChecks]

    /*
     * What the store holds after the reconcile — or would, on a dry run.
     *
     * The same expression either way, which is the point: a shadow run and a
     * real one differ in what they write, not in what they conclude. The
     * earlier version decided against Firestore directly, which on a dry run is
     * a store the reconcile never filled, so every player read as changed from
     * nothing on every tick.
     */
    const history = [...stored, ...missing]

    // 2. Read the handicaps.
    const players = await listPlayers()

    if (players.length === 0) {
        /*
         * An empty roster and a silent source are different problems with
         * different fixes, and the check below cannot tell them apart: with
         * nobody to ask about, `readings` is empty by arithmetic rather than
         * because anything went wrong, and the run reported "no handicap source
         * answered for any of 0 players". That sentence sends a reader to look
         * at WiseGolf, which is the one place the answer is not.
         *
         * Deployed, this means the players collection is missing or unreadable,
         * which is a real failure. On a laptop it means the emulator has not
         * been seeded, so the message says so — the same message serves both,
         * because the question "where did the players go" is the same question.
         */
        return {
            outcome: 'failed',
            detail:
                'there are no players in Firestore, so there were no handicaps to read. ' +
                'Locally: npm run seed -- --bootstrap',
            changes: [],
        }
    }

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

    // 3. Decide what is new, against that history.
    const { entries, changes } = decide(history, readings, now)

    const sweep = sweepOf({ readings, skipped }, isoInstantNow(now))

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
            `Shadow run: ${changes.length} observation(s) and a sweep would have been written: ${JSON.stringify(changes)}`
        )
        return { outcome: 'ok', changes }
    }

    // 4. Write them.
    if (entries.length > 0) await insert(entries)
    await insertChecks([sweep])

    // 5. Render everything and commit if the result differs from what is there.
    //
    // Rendered from memory rather than by reading the collection back. `render`
    // sorts, so the union is the same file the store would produce — and a
    // second read would only tell us what we just wrote, at the price of another
    // full scan.
    const rendered = render([...history, ...entries])
    const message =
        changes.length > 0
            ? `Update ${changes.length} ${changes.length === 1 ? "player's" : "players'"} handicap`
            : 'Reconcile the handicap observation log'
    const written = await dependencies.commit(BACKUP_PATH, rendered, message)

    /*
     * The sweep log is committed second, and separately.
     *
     * Two commits rather than one, because the Contents API writes one file at a
     * time and the trees API is the dependency `github.ts` decided against — see
     * its note on the count being the thing to watch. Two files is not yet that
     * day: the append-only guard applies per file, both are idempotent, and a
     * run that commits the first and dies before the second is repaired by the
     * next run's reconcile, which is the property the whole design rests on.
     *
     * Unconditional where the observation log's commit is not, because this file
     * gains a line on every sweep: there is no "nothing changed" case for it.
     */
    const checksWritten = await dependencies.commit(
        CHECKS_BACKUP_PATH,
        renderChecks([...checkHistory, sweep]),
        `Record a handicap sweep at ${sweep.at}`,
    )

    if (!written.ok) return { outcome: 'failed', detail: written.detail, changes }
    if (!checksWritten.ok) return { outcome: 'failed', detail: checksWritten.detail, changes }

    return { outcome: 'ok', changes, commit: written.commit }
}

/**
 * The sweep a scrape attests to, written whether or not anything moved.
 *
 * Extracted and exported so that its semantics can be pinned against the
 * workflow's `sweepOf`, which is the thing they have to match. `lastCheckedFor`
 * reads both logs the same way and takes the latest sweep that did not skip a
 * player — so while both pipelines are writing, a player counted differently by
 * the two would be dated differently depending on which sweep happened to land
 * last. That is a published number: `/events/hector/:id/handicaps.json` carries
 * it, and app.hector.golf reads it.
 *
 * `checked` is how many players a source answered for, and `skipped` is everyone
 * else — a player with no club and a player whose sources all failed are
 * deliberately not told apart, because neither was checked and that is the only
 * thing a reader acts on.
 *
 * No `undefined` case, where the workflow's version has one for a sweep that
 * reached nobody: `run` has already returned by then, on the same judgement for
 * the same reason.
 */
export function sweepOf(result: ScrapeResult, at: string): HandicapCheck {
    return { at, checked: result.readings.size, skipped: result.skipped }
}

/** Re-exported for the tests, which pin the backup's shape rather than the write. */
export { parse, render }
