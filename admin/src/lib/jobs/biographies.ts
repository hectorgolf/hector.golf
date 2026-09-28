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
import { promptFingerprint } from './biography-fingerprint.ts'
import { backendFunctionsKey } from '../secrets.ts'
import { saveBiographyDraft } from '../repository/biography-drafts.ts'
import { listEvents, listPlayers } from '../repository/events.ts'
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

/** The most recently finished Hector that somebody played. */
function lastFinishedHector(events: readonly HectorEvent[], now: Date): HectorEvent | undefined {
    const today = isoDate(now)
    return events
        .filter((event) => event.timing.end < today)
        .filter(hasParticipants)
        .sort((a, b) => b.timing.end.localeCompare(a.timing.end))[0]
}

/**
 * The Hector a run is about, and which of the two kinds it is.
 *
 * ## Why there are two, and why "none" stopped meaning "nothing to do"
 *
 * This used to be `upcomingHector` alone: no upcoming Hector, no run. That is
 * right about the *reason* to rewrite before an event — the field changes as
 * people enter — and wrong about what happens the morning after one. Every
 * biography then on the site describes the event as still to come, because that
 * is what it was when the text was written, and the job would answer "No
 * upcoming Hector with a field, so there is nothing to regenerate for" for the
 * eleven months in which those sentences were the first thing a visitor read.
 *
 * So a finished Hector is also something to write about, and the two are not the
 * same job:
 *
 *   - **Upcoming.** Everybody unlocked, every run. The answer changes as the
 *     field fills, so recency is no evidence the text is current.
 *   - **Finished.** Only the players whose biography predates it — see
 *     `currentIfWrittenAfter` in `biographiesToRegenerate`. Without that a run
 *     out of season would rewrite all forty-five every time anybody pressed the
 *     button, at a model call each, producing a different-but-equivalent
 *     paragraph for everyone.
 *
 * `hasParticipants` on both, so that an event nobody played is not a yardstick.
 * An empty field is a Hector that was scheduled and did not happen, and dating a
 * biography against it would claim the text is stale for an event that told the
 * model nothing.
 */
type ReferenceHector = { event: HectorEvent; finished: boolean }

function referenceHector(events: readonly HectorEvent[], now: Date): ReferenceHector | undefined {
    const upcoming = upcomingHector(events, now)
    if (upcoming) return { event: upcoming, finished: false }
    const finished = lastFinishedHector(events, now)
    return finished ? { event: finished, finished: true } : undefined
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
    /**
     * Stores a generated biography as a draft for review; nothing publishes it.
     *
     * An object rather than a list of positionals: the event is optional because
     * a run out of season has none to insist on, the fingerprint is what decides
     * whether the next run leaves this player alone, and three of those in a row
     * is a call somebody eventually gets in the wrong order.
     */
    save: (draft: {
        player: Player
        biography: string[]
        event: HectorEvent | undefined
        promptHash: string
    }) => Promise<void>
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

/**
 * How many players in a row may fail before the run gives up on the rest.
 *
 * This used to be one, implicitly: the first failure ended the run. The
 * reasoning was sound and is still written below — a failure is almost always
 * the key, the quota or the function being down, and none of those improves for
 * the next player, so carrying on spends forty-four more calls to collect
 * forty-four more copies of one error.
 *
 * What it missed is the failure that is *not* any of those. On 2026-09-28 a
 * sweep stopped at its fourth player because Gemini answered
 * `[503] This model is currently experiencing high demand ... Please try again
 * later`, and abandoned the 41 behind it. The function retries a 503 itself now,
 * but a spike can outlast four attempts, and when it does the next player is a
 * fresh draw rather than a repeat of the same verdict.
 *
 * **Consecutive**, not total, which is the distinction that makes one number
 * serve both cases. A dead key fails every time, so three in a row arrives
 * immediately and the run still stops after three wasted calls rather than
 * forty-five. A demand spike fails intermittently, and any success resets the
 * count — so a run that is mostly working is allowed to finish.
 *
 * Three, because each of those failures is already four attempts inside the
 * function: a dozen refusals in a row without a single success between them is
 * an outage rather than a bad afternoon.
 */
export const CONSECUTIVE_FAILURES_BEFORE_GIVING_UP = 3

/**
 * What the generator is told about one player, with this job's two local rules
 * applied: the club name comes from `clubs.json`, and a player with no club on
 * record is "unknown" rather than an empty string.
 *
 * Shared by the sweep and by `runForPlayer` so the two cannot describe the same
 * player differently. What they legitimately differ on is
 * `otherGeneratedBiographies`, which is the argument.
 */
function inputFor(
    player: Player,
    hectors: readonly HectorEvent[],
    today: ReturnType<typeof isoDate>,
    clubNames: Map<string, string>,
    otherGeneratedBiographies: string[]
): PlayerBiographyInput {
    return playerBiographyInput(player, {
        hectorEvents: [...hectors],
        today,
        // "unknown" rather than an empty string, which is what the workflow
        // hands the prompt for a player with no club on record.
        homeClub: (player.club && clubNames.get(player.club)) || 'unknown',
        otherGeneratedBiographies,
    })
}

/** The club abbreviation-to-name map the prompt wants, from the committed file. */
async function clubNamesFrom(dependencies: BiographyDependencies): Promise<Map<string, string>> {
    return new Map((await dependencies.clubs()).map((club) => [club.abbreviation, club.name]))
}

/** Every Hector in the store, which is what the prompt counts appearances against. */
async function hectorsFrom(dependencies: BiographyDependencies): Promise<HectorEvent[]> {
    return (await dependencies.events()).filter(
        (candidate): candidate is HectorEvent => candidate.format === EventFormat.Hector
    )
}

export async function run(
    dependencies: BiographyDependencies,
    dryRun: boolean
): Promise<BiographyJobResult> {
    /*
     * Which Hector this run is about — the one coming, or failing that the one
     * just played. `referenceHector` is where the difference between the two is
     * written down, and why a finished one is no longer the end of the run.
     */
    const now = dependencies.now()
    const hectors = await hectorsFrom(dependencies)
    const reference = referenceHector(hectors, now)
    if (!reference) {
        return {
            outcome: 'ok',
            detail: 'No Hector with a field, upcoming or played, so there is nothing to write about.',
            changes: [],
        }
    }

    const { event, finished } = reference

    /*
     * The club list is read before the decision rather than after it, because
     * `homeClub` is one of the facts a biography is written from and therefore
     * one of the facts that can go stale. It costs a run that decides nothing one
     * GitHub read, which is the price of the decision being right.
     */
    const today = isoDate(now)
    const clubNames = await clubNamesFrom(dependencies)
    const players = await dependencies.players()

    /*
     * What the generator would be told about each player today, fingerprinted.
     *
     * The echo context is deliberately `[]` here — it is excluded from the
     * fingerprint, and passing an empty one is what makes that structural rather
     * than a rule in a comment. See `biography-fingerprint.ts`.
     */
    const fingerprints = new Map(
        players.map((player) => [player.id, promptFingerprint(inputFor(player, hectors, today, clubNames, []))])
    )
    const isUpToDate = (player: Player): boolean =>
        player.biographyPromptHash !== undefined && player.biographyPromptHash === fingerprints.get(player.id)

    const { regenerate, claimed, upToDate, alreadyPublished } = biographiesToRegenerate(players, isUpToDate)

    const held =
        claimed.length === 0 ? '' : `; ${claimed.length} of them hand-edited (${claimed.map(nameOf).join(', ')})`
    const current = upToDate.length === 0 ? '' : `; ${upToDate.length} already current`
    const occasion = finished ? `${event.id} ended ${event.timing.end}` : `${event.id} is upcoming`
    const looked = `${occasion}; ${regenerate.length} ${regenerate.length === 1 ? 'biography' : 'biographies'} to regenerate${current}${held}`

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

    /*
     * Seeded with what the up-to-date players already say, which is load-bearing
     * rather than tidy: a biography this run is not replacing is still on the
     * page beside everything it writes, so leaving it out lets the model echo a
     * published sentence under somebody else's name.
     */
    const published = [...alreadyPublished]
    const changes: Change[] = []
    const failed: Player[] = []
    let consecutiveFailures = 0

    for (const player of regenerate) {
        const input = inputFor(player, hectors, today, clubNames, published)

        let biography: string[]
        try {
            biography = await dependencies.generate(input)
            // Any success means whatever was wrong is not wrong now. See
            // `CONSECUTIVE_FAILURES_BEFORE_GIVING_UP` for why that resets rather
            // than counts down.
            consecutiveFailures = 0
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            failed.push(player)
            consecutiveFailures += 1

            /*
             * Their existing biography joins the do-not-echo context, for the
             * reason the locked ones do: this player was *not* rewritten, so
             * what they say now stays on the page beside everything the rest of
             * this run writes. The players who succeed contribute their new text
             * a few lines below; this is the same rule for the ones who did not.
             */
            published.push(...(player.biography ?? []))

            if (consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_GIVING_UP) {
                /*
                 * Nothing is getting through, so stop rather than spend the rest
                 * of the roster proving it. What was drafted before this stays
                 * drafted and is waiting on the review page.
                 */
                return {
                    outcome: 'failed',
                    detail:
                        `${looked}. Drafted ${changes.length}, then gave up after ${consecutiveFailures} ` +
                        `failures in a row; the last was ${nameOf(player)}: ${reason}`,
                    changes,
                }
            }

            /*
             * One failure among many is a bad draw rather than a verdict on the
             * run. Carry on: the 41 players behind this one are the reason this
             * loop exists, and nothing about this player is lost — their
             * `biographyGeneratedAt` is untouched, so they stay stale and a
             * later run drafts them without anybody having to remember who they
             * were.
             */
            console.warn('Could not draft a biography; carrying on', { player: player.id, reason })
            continue
        }

        await dependencies.save({
            player,
            biography,
            event,
            // The facts this text was written from, so the next run can tell
            // whether they have moved. `fingerprints` is keyed by id and every
            // player in `regenerate` came out of the same list.
            promptHash: fingerprints.get(player.id) as string,
        })
        changes.push({
            subject: player.id,
            from: paragraphs(player.biography?.length ?? 0),
            to: paragraphs(biography.length),
        })
        published.push(...biography)
    }

    /*
     * `ok` rather than `failed` when the run got to the end with a few casualties,
     * and this is a judgement rather than an obvious reading.
     *
     * What argues for it: the drafts that succeeded are real work waiting on the
     * review page, and the ones that failed are not lost — a draft does not set
     * `biographyGeneratedAt`, only approving one does, so nobody has to write
     * down which players to come back for. Approve what is waiting and run again
     * and the stragglers are precisely what is left stale. Run again *without*
     * approving and everyone still holding an unapproved draft is redrafted,
     * which costs model calls rather than correctness.
     *
     * What argues against it is that a partial run should be visible, and a
     * green pill is not very. The compromise is that the detail names the
     * players rather than counting them: a red pill on a run that drafted
     * forty-four of forty-five would teach people that red on this job means
     * nothing, which costs more than it buys on the day something is wrong.
     */
    const missed =
        failed.length === 0 ? '' : `; ${failed.length} could not be drafted (${failed.map(nameOf).join(', ')})`
    const again = failed.length === 0 ? '' : ' Approve what is waiting and run again to catch them.'

    return {
        outcome: 'ok',
        detail: `${looked}; drafted ${changes.length} for review at /players/biographies${missed}.${again}`,
        changes,
    }
}

/**
 * One player's biography, drafted because somebody asked for that player.
 *
 * ## Why this is not the sweep with a filter
 *
 * It answers a different question, and the difference shows up in each of the
 * sweep's own rules.
 *
 * **Staleness is not consulted.** The sweep asks who *needs* rewriting — before
 * an upcoming Hector that is everybody unlocked, after a finished one only those
 * whose text predates it. Somebody pressing the button beside one player has
 * already answered that question by naming them, so telling them the biography
 * is up to date would be refusing the only thing they asked for. Both take the
 * same `referenceHector`, so the two agree about which Hector a draft is about.
 *
 * **The lock does not hold it back.** `biographiesToRegenerate` exists to stop a
 * *scheduled* rewrite taking back text somebody claimed; the lock is what makes
 * an edit survive the fortnight. A person pressing a button beside a locked
 * biography is not the thing it protects against — they are asking, now, and a
 * draft is not a publication. The drafts page already warns that approving one
 * replaces text somebody edited, and that warning is the right place for the
 * decision, because it is the point at which something is actually overwritten.
 *
 * **The do-not-echo context is wider.** See below.
 *
 * ## It costs one model call
 *
 * Which is the point. The sweep is forty-five, which is why it is off the tick
 * and why fixing one bad paragraph used to mean regenerating the other
 * forty-four along with it.
 */
export async function runForPlayer(
    dependencies: BiographyDependencies,
    playerId: string,
    dryRun: boolean
): Promise<BiographyJobResult> {
    const players = await dependencies.players()
    const player = players.find((candidate) => candidate.id === playerId)
    if (!player) {
        /*
         * A failure rather than a no-op, unlike every other "nothing to do" in
         * this module. The others are answers to a question about the data; this
         * one means the caller asked about somebody who is not there, and the
         * endpoint checks first precisely so that this stays unreachable.
         */
        return { outcome: 'failed', detail: `There is no player with id ${playerId}.`, changes: [] }
    }

    const now = dependencies.now()
    const hectors = await hectorsFrom(dependencies)
    /*
     * The same reference the sweep takes, so that two drafts made minutes apart
     * do not disagree about which Hector they are about. It was `upcomingHector`
     * alone, which meant a draft made the day after one finished recorded no
     * event at all while a sweep on the same afternoon recorded that Hector.
     *
     * What it does *not* borrow is the staleness rule. Somebody who pressed the
     * button beside one player has said which player; answering "that one is
     * already up to date" would be refusing the only thing they asked for.
     */
    const reference = referenceHector(hectors, now)
    const event = reference?.event

    const who = nameOf(player)
    const forEvent = event
        ? `for ${event.id}`
        : 'with no Hector on record to write around'
    const held = player.biographyLocked ? ', over a locked biography' : ''
    const looked = `${who}${held}, ${forEvent}`

    if (dryRun) {
        // No `Change`, for the reason the sweep gives: a change claims an after,
        // and a dry run has none to name.
        return { outcome: 'ok', detail: `${looked}. Nothing was generated: this run decides only.`, changes: [] }
    }

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

    /*
     * Every other player's biography, not only the locked ones.
     *
     * The sweep seeds this with the locked text alone, and it is right to: the
     * unlocked biographies it would otherwise include are the ones it is about
     * to replace in the same run, so quoting them would be telling the model not
     * to echo sentences that are on their way out. Nothing else is being
     * replaced here. All forty-four will still be on the page beside this one,
     * which is the condition the context exists for — see `biography-lock.test.ts`.
     *
     * The player's own current text is left out, matching the sweep. Feeding it
     * back would be asking for a paragraph that differs from the one being
     * replaced, which is a different instruction from the one this gives.
     */
    const published = players
        .filter((candidate) => candidate.id !== player.id)
        .flatMap((candidate) => candidate.biography ?? [])

    const clubNames = await clubNamesFrom(dependencies)
    const today = isoDate(now)
    const input = inputFor(player, hectors, today, clubNames, published)

    let biography: string[]
    try {
        biography = await dependencies.generate(input)
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { outcome: 'failed', detail: `${looked}. Generating it failed: ${reason}`, changes: [] }
    }

    await dependencies.save({
        player,
        biography,
        event,
        /*
         * Fingerprinted without the echo context, the same as the sweep does —
         * `input` above carries `published` and would hash differently for the
         * same facts, which is exactly the mistake `biography-fingerprint.ts`
         * exists to head off.
         */
        promptHash: promptFingerprint(inputFor(player, hectors, today, clubNames, [])),
    })

    return {
        outcome: 'ok',
        detail: `${looked}; drafted for review at /players/biographies.`,
        changes: [
            {
                subject: player.id,
                from: paragraphs(player.biography?.length ?? 0),
                to: paragraphs(biography.length),
            },
        ],
    }
}

/** Where `GeneratePlayerBiography` answers. Public to call, bearer-checked inside. */
export const BIOGRAPHY_FUNCTION = 'https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerBiography'

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
        save: ({ player, biography, event, promptHash }) =>
            saveBiographyDraft({
                playerId: player.id,
                biography,
                eventId: event?.id,
                generatedAt: new Date().toISOString(),
                promptHash,
            }),
    }
}
