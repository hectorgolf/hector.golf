# Moving the handicap scrape into Firestore

*Steps 0 to 3 shipped on 2026-09-16 and 2026-09-18: Firestore is the system of record for handicaps,
git holds a rendered backup, and the site builds from `/api/handicaps/history`. This is the one step
left. What the code does is described in
[`current/architecture.md`](../current/architecture.md) and
[`current/handicap-updates.md`](../current/handicap-updates.md); what each step did and what it cost
is in this file's git history.*

## What to do

Delete [`update-handicaps.yml`](../../.github/workflows/update-handicaps.yml). The admin's handicaps
job has replaced everything it writes but one.

Two things break quietly unless they go in the same change:

- [`refresh-admin-mirror.yml`](../../.github/workflows/refresh-admin-mirror.yml) triggers on
  `workflow_run` **by display name**. A deleted workflow means it silently never fires again.
- [`data-formatting.test.ts`](../../astrosite/test/unit/data-formatting.test.ts) asserts that
  `src/data/handicaps.json` exists and that there are more than 60 data files.

## Why

Both pipelines sweep WiseGolf on every tick and both write. Since step 2 the job is the one that
counts, so the workflow buys nothing and costs a second scrape of somebody else's API four times a
day — the cost the morning cadence was halved to pay for, which lost a Finnish venue the 04:00 tick
before its 05:00 freeze.

Leaving it also leaves two writers on data with one owner, which is the state the whole plan existed
to end.

## Blockers

**`event.buckets`, and nothing else.** The workflow has four outputs and three are settled:
`handicaps.json` moved in step 3, `handicap-checks.json` on 2026-09-18, and `player.handicap` stopped
being written by CI the same day — the site resolves it as `player.handicap ?? latest-from-the-history`,
so the stored field was only ever load-bearing for a player WiseGolf has never heard of.

Buckets are written into event documents, and Firestore holds Hector events as a **mirror the admin
reads** rather than as their source. A job writing buckets there puts a scheduled writer and an
unsynchronised export on the same documents, which is the conflict
[`data-ownership.md`](../current/data-ownership.md) exists to prevent. Handicaps escaped that rule
because nobody authors a handicap; events do not, because people author them.

So this waits on Hector events being authorable in the admin — the same blocker
[`bucket-locking.md`](./bucket-locking.md) and [`biography-locking.md`](./biography-locking.md) wait
on. Deleting the workflow before buckets have a home freezes every upcoming split at whatever it last
was, which is the one irreversible mistake available here.
