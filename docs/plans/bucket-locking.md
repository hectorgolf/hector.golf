# Locking a Hector's buckets early

*Phases 1-3 shipped 2026-09-18; this is what is left. The reasoning behind the built part, and the
record of what each phase cost, is in this file's git history — what the code does is described in
[`current/architecture.md`](../current/architecture.md#published-data) and
[`current/data-ownership.md`](../current/data-ownership.md).*

## What to do

Let the admin set and clear `event.bucketsLocked`, ideally beside an editor for the split itself.

The field exists, `update-handicaps` skips a locked event and says so, and
`/events/hector/:id/handicaps.json` publishes it as `buckets_locked`. Setting it today means editing
the event's JSON file by hand and committing it, which is how Hector events are edited at all.

## Why

Buckets decide the Draft after round one, they are recomputed from handicaps on every tick, and
handicaps move at any hour. `bucketsAreOpen()` already freezes them at 08:00 on the first morning, so
what is left for the lock is settling a split **earlier** than that: the moment somebody announces it
and stops calling it projected. Without the lock a scrape that night reshuffles the halves, the page
quietly disagrees with what the players were told, and the first anyone knows is on the tee.

Editing the file by hand already covers that case, which is why phases 1-3 were worth building alone.
What the admin adds is the other half — a way to *make* a split CI got wrong, for a late replacement
whose federation record has not caught up or an odd number cutting between two equal handicaps. The
lock makes a hand-made split survive the next scrape; until something can make one, there is nothing
to protect.

## Blockers

**Hector events are not authorable in the admin.** `admin/src/lib/ownership.ts` owns matchplay and
mirrors everything else, so `npm run seed` refreshes Hector events from the committed files after
every scrape and a lock written to the mirror is reverted within hours. Moving events into the owned
column is the blocker — the same one [`biography-locking.md`](./biography-locking.md) and
[`handicaps-to-firestore.md`](./handicaps-to-firestore.md) are waiting on.

This goes in with a bucket editor rather than ahead of one. Alone it protects a split CI computed;
the pair is what lets somebody fix one.
