import { EventFormat } from '@hector/schemas/src/events.ts'

import { OWNED_FORMATS } from './ownership.ts'

/**
 * Why a record can be looked at here but not changed here.
 *
 * The admin shows every event, every player and every course; it authors
 * matchplay, players and courses. What is left over is a mirror — Firestore's
 * copy of a committed file, refreshed by `npm run seed` after every scrape — and
 * a page that shows one without saying so invites the edit it cannot accept.
 * Worse, the edit would appear to work: writing to the mirror succeeds, and the
 * next seed reverts it within hours, silently. `docs/current/data-ownership.md`
 * is the decision; this is the sentence the UI says about it.
 *
 * Two mirrors are left, both event formats, which is why everything below is
 * keyed by one. `PLAYER_MIRROR` and `COURSE_MIRROR` were here and went with
 * their flips — on 2026-09-21 and 2026-09-22 — because a collection the admin
 * authors has nothing to explain away, and a notice that outlives the
 * limitation it describes is the lie this file exists to prevent. The courses
 * one outlived it by a day: the editor shipped, the flag flipped, and both
 * course pages went on apologising for a Save button that was right there.
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
/*
 * Half of this event's one remaining scheduled writer has moved here too, and
 * the half that is left is the one named below.
 *
 * `results.teams` is back-filled from a live leaderboard, and since 2026-09-24
 * that is two writers rather than one: the admin's `leaderboards` job for the
 * events published on app.hector.golf, and `update-leaderboards.yml` for the
 * sheet-sourced ones. Only the second is still outside this service, so only the
 * second is a price of the flip.
 *
 * Listed anyway rather than rounded down to nothing, because the flip's rule is
 * about writers and not about how many events each one reaches. A sheet-sourced
 * Hector is one event file away, and the day somebody adds one is the day a
 * quietly emptied list would be wrong.
 */
const HECTOR: Mirror = {
    authoredAt: 'astrosite/src/data/events/hector/',
    scheduledWriters: ['update-leaderboards (results.teams, sheet-sourced events)'],
}

/**
 * Kept although nothing renders it: the admin's Finnkampen pages were removed on
 * 2026-09-20, so no page asks for this today.
 *
 * It stays because `eventMirror` returning undefined is how a format says *the
 * admin owns me*, and answering that about a mirrored format would be a lie with
 * consequences — a page added later would render no notice and invite the edit
 * the next seed reverts. `mirror.test.ts` holds the invariant: every format in
 * `MIRRORED_FORMATS` has an explanation, page or no page.
 */
const FINNKAMPEN: Mirror = {
    authoredAt: 'astrosite/src/data/events/finnkampen/',
    scheduledWriters: [],
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
