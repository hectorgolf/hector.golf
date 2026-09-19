import { EventFormat } from '@hector/schemas/src/events.ts'

import { OWNED_FORMATS } from './ownership.ts'

/**
 * Why a record can be looked at here but not changed here.
 *
 * The admin shows every event and every player; it authors matchplay and
 * nothing else. So most of what these pages render is a mirror — Firestore's
 * copy of a committed file, refreshed by `npm run seed` after every scrape — and
 * a page that shows one without saying so invites the edit it cannot accept.
 * Worse, the edit would appear to work: writing to the mirror succeeds, and the
 * next seed reverts it within hours, silently. `docs/current/data-ownership.md`
 * is the decision; this is the sentence the UI says about it.
 *
 * `eventMirror` asks `OWNED_FORMATS` rather than carrying its own list of what
 * is editable, which is the property worth keeping when these pages grow forms:
 * the day a format moves into that set, its notice disappears on its own rather
 * than being a second place somebody has to remember.
 */
export type Mirror = {
    /** Where the record is edited today, as a path somebody can open. */
    authoredAt: string
    /**
     * The scheduled writers that have to move into this service before the admin
     * can own the collection — the price of the flip, per
     * `docs/plans/authoring-players-and-events.md`, and empty for a collection
     * nothing writes on a schedule.
     */
    scheduledWriters: readonly string[]
}

/**
 * `event.buckets` is deliberately absent from this list.
 *
 * It used to be half of it. The admin's handicaps job recomputes every open
 * split and commits the event JSON to git — the same write `update-handicaps.yml`
 * was making, which is why that workflow could be deleted on 2026-09-20 without
 * this collection changing hands. So the writer has moved into this service
 * already, and what is left for the flip is turning a git writer into a
 * Firestore one rather than moving a job.
 */
const HECTOR: Mirror = {
    authoredAt: 'astrosite/src/data/events/hector/',
    scheduledWriters: ['update-leaderboards (results.teams)'],
}

const FINNKAMPEN: Mirror = {
    authoredAt: 'astrosite/src/data/events/finnkampen/',
    scheduledWriters: [],
}

/** Players, which have no `OWNED_FORMATS` of their own to be absent from yet. */
export const PLAYER_MIRROR: Mirror = {
    authoredAt: 'astrosite/src/data/players/',
    scheduledWriters: [
        'update-player-biographies (biography)',
        'update-player-club-memberships (club)',
    ],
}

const EVENT_MIRRORS: Record<EventFormat, Mirror | undefined> = {
    [EventFormat.Hector]: HECTOR,
    [EventFormat.Finnkampen]: FINNKAMPEN,
    // Authored here, so there is nothing to explain away.
    [EventFormat.Matchplay]: undefined,
}

/**
 * How this format is mirrored, or undefined when the admin authors it.
 *
 * The ownership set decides, and the table above only supplies the detail: a
 * format the admin owns gets no notice whatever the table says, so the two
 * cannot drift into disagreeing about which is which.
 */
export function eventMirror(format: EventFormat): Mirror | undefined {
    if (OWNED_FORMATS.has(format)) return undefined
    return EVENT_MIRRORS[format]
}
