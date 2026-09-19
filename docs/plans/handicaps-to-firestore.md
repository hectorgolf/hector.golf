# Moving the handicap scrape into Firestore

*Steps 0 to 3 shipped on 2026-09-16 and 2026-09-18: Firestore is the system of record for handicaps,
git holds a rendered backup, and the site builds from `/api/handicaps/history`. This is the one step
left. What the code does is described in
[`current/architecture.md`](../current/architecture.md) and
[`current/handicap-updates.md`](../current/handicap-updates.md); what each step did and what it cost
is in this file's git history.*

## What to do

Give the admin's handicaps job the bucket recompute, writing the changed event files **to git**, and
then delete [`update-handicaps.yml`](../../.github/workflows/update-handicaps.yml).

## Why

Both pipelines sweep WiseGolf on every tick and both write. Since step 2 the job is the one that
counts, so the workflow buys nothing and costs a second scrape of somebody else's API four times a
day — the cost the morning cadence was halved to pay for, which lost a Finnish venue the 04:00 tick
before its 05:00 freeze.

Leaving it also leaves two writers on data with one owner, which is the state the whole plan existed
to end.

## Why to git, and not to Firestore

The workflow has four outputs and three are settled: `handicaps.json` moved in step 3,
`handicap-checks.json` on 2026-09-18, and `player.handicap` stopped being written by CI the same day
— the site resolves it as `player.handicap ?? latest-from-the-history`, so the stored field was only
ever load-bearing for a player WiseGolf has never heard of.

The fourth is `event.buckets`, and an earlier version of this plan had it blocked indefinitely.
Buckets are written into event documents, and Firestore holds Hector events as a **mirror the admin
reads** rather than as their source, so a job writing buckets *there* puts a scheduled writer and an
unsynchronised export on the same documents — the conflict
[`data-ownership.md`](../current/data-ownership.md) exists to prevent. That reasoning is sound and it
is about Firestore specifically.

The job does not have to write Firestore. It already commits twice a run through `github.ts`, and a
bucket recompute committed to `astrosite/src/data/events/hector/*.json` is the same write the
workflow makes, from a different process. Git stays the source for Hector events, the mirror stays
one-way, `ownership.ts` is untouched, and the `event.buckets` row in `data-ownership.md` — *Derived,
owned by CI* — stays literally true. "CI" becomes the admin service, which is already what that word
means for the handicap observations row above it.

**This does not make Hector events authorable.** [`bucket-locking.md`](./bucket-locking.md) and
[`biography-locking.md`](./biography-locking.md) name the same blocker this one used to, and they
still wait on it. All this moves is the writer.

## Steps

### A. Move the pure bucketing code out of the file being deleted

Four pieces live in `update-handicaps.ts` itself — `getPlayerHandicapFromHistory`,
`sortPlayersForBucketing`, `bucketsToRecompute`, and the split-in-half logic inlined in its loop.
Three more live in [`data.ts`](../../astrosite/src/code/data.ts): `bucketsAreOpen`,
`bucketsFreezeAt`, `hasParticipants`. The admin cannot import that module at all — it does a
top-level `await glob(...)` over the filesystem at module scope.

So: a new `packages/schemas/src/buckets.ts` for the bucketing rules, with
`getPlayerHandicapFromHistory` going beside `latestPerDay` in `handicaps.ts` instead, and `data.ts`
re-exporting the predicates so the site's import paths do not churn.

Two snags worth knowing before starting:

- **`@hector/schemas` depends on `zod` and nothing else**, and `bucketsFreezeAt` needs luxon. Add it;
  astrosite already ships it, and a bucketing rule is exactly the site/admin/pipeline contract that
  package exists to hold.
- **The sort's last tiebreak is not portable.** `sortPlayersForBucketing` falls back to
  `getPlayerName`, which renders a privacy-shortened last name via a closure over the whole roster
  read from disk — so it cannot move. The comparator takes the name function as a parameter instead:
  the site passes `getPlayerName`, the admin passes `first last`. The two cannot disagree on today's
  data, because a shortened last name is the shortest *unique* prefix within a first-name group and
  so differs from its neighbours before the truncation point — but that is a property of the roster
  rather than of the code, which is why the function is injected rather than replaced.

Behaviour-preserving, and green on its own: the workflow still runs, importing from the new home.
The existing tests are the proof — `bucketing.test.ts`, `handicap-history.test.ts`,
`handicap-observation-log.test.ts` and `bucket-lock.test.ts` all import from
`src/workflows/update-handicaps` today. Repoint them; do not rewrite them.

These functions carry long docblocks and `packages/schemas` takes one-liners. The 08:00-freeze
rationale and the `bucketsAreOpen`-versus-`bucketsLocked` distinction belong in `bucket-lock.test.ts`
and in the commit message, not in the schema file.

### B. Two additions to `github.ts` and `jobs/registry.ts`

- **`listDirectory(path)`** — the Contents API on a directory, one call, to find the Hector event
  files. Taking the ids from the Firestore mirror instead would mean a mirror that lost a document
  silently drops an event from the recompute.
- **A commit path that skips the append-only guard.** `commit()` in `registry.ts` bakes `guard()` in,
  and a bucket write is a rewrite rather than an append. Lift the lost-race retry out of the guard so
  bucket commits keep the retry without the check.

`COMMIT_ATTEMPTS = 3` was reasoned about against "four workflows, one push each per tick". This adds
up to thirteen more commit targets per run — in practice nearly always zero or one, since only
changed events commit, but the number was chosen for a stated reason and the reason should be
restated rather than quietly outgrown.

### C. The bucket step in the job, writing nothing at first

After step 5, from the `readings` and `listPlayers()` result already in memory: read the Hector
event files from git, `bucketsToRecompute(events, now)`, then for each open unlocked event resolve
handicaps, sort, split, compare to `event.buckets`, and commit only what differs. Every change goes
in the run log as a `Change`, and every skipped event says why — a recompute that stops silently
reads as a bug the first time somebody wonders why the buckets did not move.

Three things differ from the workflow and are decisions rather than inheritances:

1. **Formatting has to be byte-identical.**
   [`data-formatting.test.ts`](../../astrosite/test/unit/data-formatting.test.ts) holds every
   committed data file to `serializeJson(JSON.parse(raw))`. Use `serializeJson` from
   `@hector/schemas/src/json.ts`, as `admin/scripts/export.ts` already does, and add a round-trip
   test over the committed Hector files so that a Zod parse dropping or reordering a key fails in CI
   rather than in a three-hundred-line diff.
2. **Player names now come from the Firestore mirror.** Fine for names, which are authored and
   stable. Handicaps do not come from there — they come from the observation log the job owns.
3. **An unknown participant id is silently dropped today.** The workflow's `?.filter((p) => !!p)`
   means a participant with no player record vanishes from the split. Reading from a mirror makes
   that more reachable, not less. Fail the bucket step loudly instead of inheriting it.

Land this computing and logging but committing nothing, and let it run beside the workflow for a few
ticks. The dispatch ordering already makes the comparison meaningful: workflows are dispatched
first and jobs run second, against the same base state. `dryRun` is a property of the whole job by
design, so this needs its own narrower switch rather than flipping that flag.

**The bar is one tick where the buckets actually move and both pipelines produce the same split.**
Agreement on unchanged buckets proves nothing. Step 2 asked for a week of boring diffs and settled
for two days plus a single paired decision, on the grounds that the changes stop for the season in
October; the same reasoning applies here and the season is shorter now than it was then.

### D. Delete the workflow

Delete the file and its entry in `DISPATCHABLE_WORKFLOWS`. Three things break quietly unless they go
in the same change:

- [`refresh-admin-mirror.yml`](../../.github/workflows/refresh-admin-mirror.yml) triggers on
  `workflow_run` **by display name**, so a deleted workflow means it silently never fires again — and
  it matters more now, not less, because the mirror has event buckets to catch up with. Have the job
  dispatch it on commit, the way `publishes: true` already dispatches a deploy.
- [`data-formatting.test.ts`](../../astrosite/test/unit/data-formatting.test.ts) asserts that
  `src/data/handicaps.json` exists and that there are more than 60 data files. The file stays on
  disk, frozen, so the assertion keeps passing while meaning less than it says. Leave it:
  `handicaps.json` is still `LEGACY_PATH` for the job's self-healing reconcile. Deleting the file and
  that reconcile is a separate change.
- **A commit made with this service's token triggers workflows**, unlike one made with
  `GITHUB_TOKEN` — which is why `BACKUP_PATH` lives outside `astrosite/`. Bucket commits land
  *inside* it, so `deploy-site.yml`'s `on: push` filter fires on its own and the job's explicit
  deploy request would make that two deploys per bucket change. Settle it here rather than discover
  it in production.

## Docs

Not a trailing step. Each of A to D carries its own `current/` update:
[`handicap-updates.md`](../current/handicap-updates.md), whose chain diagram still reads
`update-handicaps.ts → handicaps.json`; [`data-ownership.md`](../current/data-ownership.md), whose
`event.buckets` row needs its writer named; `architecture.md` §8; and
[`bucket-locking.md`](./bucket-locking.md), whose blocker narrows rather than clears — the job reads
the lock, but still nothing can set one.
