import { serializeJson } from '@hector/schemas/src/json.ts'
import { NullHandicapSource, type GolfClub, type HandicapSource } from '@hector/wisegolf/src/handicap-source-api.ts'
import { createWisegolfSession } from '@hector/wisegolf/src/wisegolf-api.ts'

import { wisegolfCredentials } from '../secrets.ts'
import type { Change } from './log.ts'

/**
 * Keeping `astrosite/src/data/clubs.json` current.
 *
 * The second output of `update-player-biographies.yml`, and the reason moving
 * the biographies alone does not let that workflow be deleted: it refreshes the
 * club list unconditionally, before it even checks whether there is a Hector to
 * generate for.
 *
 * ## Its own job rather than part of the biographies one
 *
 * The two share a workflow by historical accident, not by subject. A club list
 * is not a biography, it is refreshed on a different rhythm, and the biographies
 * job is deliberately one that writes nothing — bolting a git write onto it
 * would make that sentence stop being true for a file that has nothing to do
 * with it.
 *
 * ## It writes git, and that is where this ends rather than a stepping stone
 *
 * Unlike the player writers, this one is not waiting for an ownership flip.
 * `clubs.json` is derived, has no human writer and nothing authors it, which
 * `docs/current/data-ownership.md` describes as the third arrangement: the file
 * stays committed and the collection never joins the exported column.
 *
 * ## Why the file survives at all
 *
 * Nothing in the repository reads it today — no import, no glob, and it sits
 * under `src/` rather than `public/`, so it is not served either. It is kept
 * because it is the only list of valid club abbreviations anywhere here, and the
 * player editor step 1 builds will want exactly that for a club picker. Until
 * then it is a reference for whoever is hand-editing `player.club`, which is
 * still how a club gets set.
 *
 * Nothing enforces that a club somebody types is in this list, and until
 * 2026-09-20 one was not: two players carried `KJKG`, which WiseGolf does not
 * list, and `6ca4e486` corrected them to `Koto`. All twenty-four values in use
 * match today. Worth knowing when the picker is built — reading this file will
 * make new clubs consistent, and says nothing about the ones already set.
 */

/** Where the committed club list lives, relative to the repository root. */
export const CLUBS_PATH = 'astrosite/src/data/clubs.json'

/**
 * How long a club list is considered current.
 *
 * Golf clubs are not founded weekly. The workflow this replaces refreshed on a
 * 15-day cadence only because that is how often it regenerated biographies — the
 * club list came along for the ride — so thirty days is a deliberate number
 * rather than an inherited one. The cost of being wrong is a picker offering a
 * list up to a month old.
 */
export const REFRESH_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The file's shape, which gained a timestamp when this job took it over.
 *
 * The alternative was a marker document in Firestore recording when WiseGolf was
 * last asked. Keeping it in the file is better in three ways: the stamp and the
 * data it describes are written together and cannot drift apart, it survives a
 * Firestore that is rebuilt from nothing, and the club picker that will read this
 * file gets to say *how old* the list is without being told separately.
 *
 * It has one consequence worth knowing rather than discovering. `fetchedAt`
 * changes on every refresh even when no club has, so a refresh always commits —
 * where a bare array would have been byte-identical and committed nothing. That
 * is about twelve commits a year against a repository that already takes several
 * a day from the handicap sweeps, and each one says plainly what it is.
 */
export type ClubList = {
    /** When WiseGolf was asked, not when a club last changed. */
    fetchedAt: string
    clubs: GolfClub[]
}

export type ClubsDependencies = {
    readFile: (path: string) => Promise<string | undefined>
    sources: () => Promise<HandicapSource[]>
    commit: (text: string, message: string) => Promise<{ ok: true; commit: string } | { ok: false; detail: string }>
    now: () => Date
}

export type ClubsJobResult = {
    outcome: 'ok' | 'failed' | 'skipped'
    detail?: string
    changes: Change[]
    commit?: string
}

/**
 * When the committed list was last fetched, as far as the file admits.
 *
 * Undefined for a file that is missing, unreadable, or still the bare array this
 * job inherited — and all three mean the same thing to the caller, which is
 * "ask WiseGolf". That makes the first run after this ships the migration: it
 * reads an array, finds no stamp, refreshes, and writes the new shape. There is
 * no separate step to remember.
 */
export function fetchedAt(text: string | undefined): Date | undefined {
    if (!text) return undefined
    try {
        const parsed = JSON.parse(text) as Partial<ClubList>
        if (typeof parsed?.fetchedAt !== 'string') return undefined
        const when = new Date(parsed.fetchedAt)
        return Number.isNaN(when.getTime()) ? undefined : when
    } catch {
        // A file we cannot parse is one we are about to overwrite anyway.
        return undefined
    }
}

/** Sorted and de-duplicated by abbreviation, the way the workflow wrote it. */
export function clubList(found: readonly GolfClub[]): GolfClub[] {
    const byAbbreviation = new Map<string, GolfClub>()
    for (const club of found) {
        if (!byAbbreviation.has(club.abbreviation)) byAbbreviation.set(club.abbreviation, club)
    }
    return [...byAbbreviation.values()].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation))
}

/** Whole days between two moments, or undefined when the first is missing. */
export function daysSince(then: Date | undefined, now: Date): number | undefined {
    if (!then) return undefined
    return Math.floor((now.getTime() - then.getTime()) / DAY_MS)
}

export async function run(dependencies: ClubsDependencies, dryRun: boolean): Promise<ClubsJobResult> {
    const now = dependencies.now()
    const age = daysSince(fetchedAt(await dependencies.readFile(CLUBS_PATH)), now)

    /*
     * Skipped rather than ok, and the distinction is load-bearing: `ok` is what a
     * run that actually asked WiseGolf reports, so a reader of the run log can
     * tell a refresh from a decision not to refresh.
     */
    if (age !== undefined && age < REFRESH_AFTER_DAYS) {
        return {
            outcome: 'skipped',
            detail: `The club list was fetched ${age} ${age === 1 ? 'day' : 'days'} ago; WiseGolf was not asked again.`,
            changes: [],
        }
    }

    const usable = (await dependencies.sources()).filter((source) => !(source instanceof NullHandicapSource))
    if (usable.length === 0) {
        return { outcome: 'skipped', detail: 'No handicap source is configured, so nothing was asked.', changes: [] }
    }

    const clubs = clubList((await Promise.all(usable.map((source) => source.getClubs()))).flat())

    /*
     * The workflow's guard, kept: no source answering is an outage, not a world
     * with no golf clubs in it, and this file is the only copy. Writing an empty
     * list would replace 140 clubs with nothing, and nothing would fail.
     */
    if (clubs.length === 0) {
        return {
            outcome: 'skipped',
            detail: 'No source listed any clubs, so the committed list was left alone.',
            changes: [],
        }
    }

    const asked = `${clubs.length} clubs from ${usable.length === 1 ? usable[0]!.name : `${usable.length} sources`}`
    if (dryRun) return { outcome: 'ok', detail: `${asked}; nothing was written.`, changes: [] }

    const list: ClubList = { fetchedAt: now.toISOString(), clubs }
    const outcome = await dependencies.commit(
        serializeJson(list),
        `Refresh the golf club list (${clubs.length} clubs)`
    )
    if (!outcome.ok) return { outcome: 'failed', detail: outcome.detail, changes: [] }

    return { outcome: 'ok', detail: `${asked}; committed.`, changes: [], commit: outcome.commit }
}

/** The real dependencies, minus the two `registry.ts` supplies for every job. */
export const LIVE: Omit<ClubsDependencies, 'readFile' | 'commit'> = {
    sources: async () => [await createWisegolfSession(await wisegolfCredentials())],
    now: () => new Date(),
}
