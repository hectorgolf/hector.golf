# Moving the handicap scrape into Firestore

*Written 2026-09-15. **Steps 0 to 3 are done and deployed, all on 2026-09-16 and 2026-09-18.** The
job shadowed `update-handicaps.yml`, the two pipelines decided the same live change independently and
agreed, the job began writing for real, and the site now builds from `/api/handicaps/history` with the
committed NDJSON as a credential-less fallback. Firestore is the system of record for handicaps and
git holds a backup. Step 4 is all that is left, and it is blocked on three outputs of
`update-handicaps.yml` that this plan does not otherwise touch. What each step did, and what it cost,
is recorded under the step.*

The handicap history is the first dataset to move from "a JSON file in git, written by a GitHub
Actions runner" to "a Firestore collection, written by the admin service". This document is the plan
for that move, and — because three more scrapes follow it — for the harness the move is built on.

Read it end to end before starting. The order matters in one place that is not obvious: step 4
deletes [`update-handicaps.yml`](../../.github/workflows/update-handicaps.yml), and that workflow
writes three things this plan does not otherwise mention.

## Why

The goal is not to get the scraping off GitHub's runners. It is to make **Firestore the system of
record** for events, courses and players, so that the admin UI can grow visual editors for them. An
editor can only be built on data the admin owns; today it owns matchplay events and nothing else.

[`data-ownership.md`](../current/data-ownership.md) already states the rule this plan obeys:

> A collection moves into the exported column on the day the admin can author it **and** its
> scheduled writer has been moved to Firestore. Those two things have to happen together: either one
> alone recreates the conflict in the other direction.

This plan is the second half of that pair, for one dataset. The editors are the first half, for the
others.

### Why handicaps first, and what that does not prove

Handicaps are the safest possible rehearsal: `Derived / CI` in the ownership table, append-only, and
with no human writer to conflict with. Nobody will ever hand-edit handicap history, so the migration
exercises the plumbing — a scheduled writer in Cloud Run, a lock, a run log, a git backup — without
risking an edit.

That is the argument for doing it first. It is also the reason a clean cutover here should **not** be
read as evidence that the editor problem is solved. The hard rows in the ownership table are the
other ones: `player.handicap` as a stopgap CI supersedes, `player.biography` as authored-in-intent-
only, `event.buckets` recomputed until it freezes. None of them are touched by this plan.

## The deadline nobody set

Step 2 compares two live pipelines against each other, which needs handicaps to actually move. They
stop moving in October:

| Month | 2025-09 | 2025-10 | 2025-11 | 2025-12 – 2026-02 | 2026-03 |
| --- | --- | --- | --- | --- | --- |
| Entries written | 71 | 3 | 2 | 0 | 14 |

Since June 2026 the rate has been about 2.7 changes a day on roughly 90% of days. A week of
dual-running in late September yields something like 19 changes across 6 days — thin, but enough to
see the shape. The same week started in late October yields approximately nothing, and the choice
then is between shipping on no evidence and waiting until March.

**Step 1 has been running since 16 September**, so the window was met with about three weeks to
spare. What remains of the deadline applies to step 2: the shadow period has to see enough paired
decisions to be worth having *before* the changes stop, and at 2.7 a day that is days rather than
weeks of waiting — as long as somebody looks.

Most of the validation did not need to wait at all, which is what made the short window survivable:

- The git → Firestore reconcile is deterministic given the 1,406 existing entries. Replay it offline
  and diff. There is a test for this in step 0.
- The Firestore → NDJSON render is deterministic. Assert that it round-trips to today's
  `handicaps.json` byte for byte.
- Only the WiseGolf scrape and the commit path genuinely need live running, and step 1 runs those in
  shadow mode from day one.

## What the current job actually does

`updateHandicapsForAllPlayers()` is about a third of
[`update-handicaps.ts`](../../astrosite/src/workflows/update-handicaps.ts). The run has four outputs,
not one:

| Output | Written by | Read by |
| --- | --- | --- |
| `handicaps.json` | `persistHandicapHistoryToDisk` | the site's handicap history and charts |
| `players/*.json` `handicap` | `updatePlayerData`, inside the change loop | the site's current-handicap stopgap |
| `handicap-checks.json` | `persistHandicapCheckToDisk`, on **every** run | `lastCheckedFor()` → the `observed` stamps published at `/events/hector/:id/handicaps.json`, which app.hector.golf consumes |
| `event.buckets` | `updateBucketsForUpcomingEvents` | event pages, until the 08:00 freeze on the first morning |

Only the first moves in this plan. The other three are why step 4 is last, and why it is the one
irreversible mistake available here: deleting the workflow before they have a new home silently
stops a published contract (`handicap-checks.json`) and freezes the buckets at whatever they last
were.

## The shape: a job harness, not an endpoint

Three more scrapes follow this one — leaderboards, biographies, club memberships — so the first
artifact is deliberately not `/api/handicaps/update`. Every one of those jobs wants the same five
things:

1. **Scrape** a source. Three of the four are WiseGolf, so the client has to come out of
   `astrosite/src/code/handicaps/` regardless.
2. **Reconcile** against Firestore — not diff-and-append. See below.
3. **Record the run**: who asked, what changed, what failed.
4. **Render and commit the git backup**, behind an append-only guard.
5. **Dispatch the deploy** if anything changed.

So the endpoint is `POST /api/jobs/:slug/run`, with a per-job scrape-and-reconcile function and one
shared harness around it. The Cloud Scheduler tick already fans out over a list in
[`workflows.ts`](../../admin/src/lib/workflows.ts); this is the same list with a different verb, and
adding the leaderboards job later is one entry.

### Three decisions the harness makes once

**Reconcile, never append.** Every job renders its full output from Firestore, compares it to what is
in git, and commits on difference. The tempting alternative — "if this run found changes, append
them" — fails silently: a run that writes Firestore and then dies before committing leaves the two
stores permanently apart, and the next run finds no changes and never repairs it. Reconciling is
self-healing, makes retries free, and collapses the git→Firestore backfill and the Firestore→git
render into one operation rather than two half-syncs pointing in opposite directions.

**A lock, in Firestore.** The four data workflows share the `data-update` GitHub concurrency group
*because they all push to git*. Move them into a service with `max_instance_count = 2`, four ticks a
day and `retry_count = 3`, and that interlock is gone. A transaction on a `job-locks` document
restores it. This is the single most important thing to get right before job number two exists.

**A run log, in Firestore.** The Operations page reads GitHub's run list today. Once the work happens
in-process there is no run to read, and the page's "4 hours ago" staleness hint goes blank for
exactly the job nobody is yet sure about. The run log is also where the shadow diffs in step 1 go,
which is why it is built first rather than last.

### The backup, and what makes it one

The NDJSON file in git is a **backup**: generated, disposable, not the source of truth, and not what
the site builds from once step 3 lands. Two things follow.

The first is that the append-only guard is essential rather than decorative. If the endpoint renders
the whole file from Firestore every run, a bad Firestore write is faithfully copied into the backup
on the next tick, and the mistake is discovered weeks later with nothing to recover from. The guard
— refuse the commit, log loudly, and fail the run if any previously committed line has disappeared
or changed — is the difference between a backup and a mirror. It is about twenty lines.

The second is that nothing should build from it. A backup that is also the build input is not a
backup; it is the production path under a misleading name. This is why step 3 moves the site's
reader **once**, straight to the API, rather than to the NDJSON and then off it again.

## The steps

### Step 0 — prerequisites ✅ *done 2026-09-16*

None of these needed the season, a deploy, or a decision.

- `packages/wisegolf/`: lift `handicap-source-api.ts`, `wisegolf-api.ts` and `http-helpers.ts` out of
  `astrosite/src/code/handicaps/`. Two other workflows already import them, so this pays for itself
  before the admin uses it at all.
- WiseGolf credentials in Secret Manager, with an accessor binding for `admin_runtime`. Following the
  existing rule in [`secrets.tf`](../../terraform/secrets.tf): Terraform creates the container and
  never the value, and the container spec never names a secret version.
- `secrets.ts` generalised past its single hardcoded GitHub token.
- The GitHub token gains `Contents: read and write` — done 2026-09-16, see below. Note the
  consequence in *Decisions* below.
- Firestore: `handicap-observations`, `job-runs`, `job-locks`.
- The offline replay test: 1,406 committed entries → Firestore documents → rendered NDJSON, asserted
  equal to today's `handicaps.json` under `latestPerDay`.

**What it turned up.** Lifting the WiseGolf client needed one change rather than a move: it read
`process.env` at import time, which a service holding its credentials in Secret Manager cannot use,
so `createWisegolfSession` grew an optional credentials argument.

The replay found something the plan had not anticipated. `compareObservations` in `@hector/schemas`
is not a *total* order — a sweep stamps every reading with one instant, so a morning that moves nine
handicaps produces nine entries it considers equal. The rendered file's line order would therefore
have depended on the order Firestore returned documents in, and the append-only guard would have
refused the result. The render breaks the tie on `player`; the shared comparator is left alone.

**The token's `Contents: read and write` was granted on 2026-09-16**, and it is worth being precise
about what that did and did not change, because the obvious reading is wrong.

It did not fix reading. This repository is public, and a fine-grained token gets public read access
whatever its Contents permission says — which is why the very first shadow run's reconcile pulled
`handicaps.json` down and reported `0 changes` rather than throwing. The read path has worked all
along and proves nothing about the write path.

What it enables is the commit in step 2, and **nothing exercises it until then**. A `Contents` scope
that is still wrong will surface as a failed commit at the moment `dryRun` goes off, not before. The
cheap way to find out earlier, which does not write anything:

```bash
TOKEN=$(gcloud secrets versions access latest --secret=github-dispatch-token --project=hector-golf)
curl -s -H "Authorization: Bearer $TOKEN" https://api.github.com/repos/hectorgolf/hector.golf \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["permissions"])'
```

`push: True` is the answer that means step 2 can commit.

### Step 1 — shadow ✅ *deployed 2026-09-16 08:26 UTC*

`POST /api/jobs/handicaps/run`, authenticated the way everything else here is: IAP, via the
[`request-deploy`](../../.github/actions/request-deploy/action.yml) pattern of WIF → ID token for the
IAP audience. Not an API key — see *Decisions*.

Triggered by the **existing** Cloud Scheduler tick, not by a job of its own. The two jobs already
call `/api/workflows/dispatch`, which fans out over everything marked `scheduled` — now the jobs in
`jobs/registry.ts` as well as the workflows in `workflows.ts`. Adding a dataset to the tick is an
entry in a list rather than an infrastructure change, and Cloud Scheduler's free three jobs stay at
two.

Not a GitHub `schedule:` cron, which is the mechanism [`workflows.ts`](../../admin/src/lib/workflows.ts)
documents as running 2–4½ hours late and is the reason Cloud Scheduler exists at all.

**The tick dispatches the workflows first and runs the jobs second, and that ordering is what makes
the shadow period worth running.** The job reads `handicaps.json` at the start of its run, seconds
after the dispatch and minutes before `update-handicaps.yml` commits anything — so both pipelines
decide against the same base state and their answers are directly comparable. A job scheduled an hour
*later* would read a file the workflow had already updated, and would agree with it by construction,
having been told the answer. That was the blind spot in the first draft of this plan, and the fix was
free.

It costs a second WiseGolf sweep per tick. The morning cadence dropped from hourly to two-hourly to
pay for it, so that is eight sweeps a day during the shadow period against four after it, rather
than twelve against six.

`dryRun` is on: the run reconciles *in memory*, scrapes, computes the diff, writes it to the run log,
and touches neither the observations collection nor git. The in-memory part matters: a dry run that
skipped the reconcile and then compared against an empty Firestore would report all 45 players as
changed on every tick, which is noise rather than evidence. `update-handicaps.yml` continues untouched
and remains the only writer.

A failing job does not fail the tick. A failed *dispatch* returns 502 and Cloud Scheduler retries; a
failed *job* is recorded and the tick still succeeds, because otherwise a job broken for a boring
reason — no WiseGolf credentials yet — would have every retry re-dispatch the workflows and re-run
the scrape. The next tick is the retry, and there are four a day.

Watch the run log until the diffs are boring. The run log is on `/operations`, under **Jobs this
service runs itself** — a card per job with a **Shadow run** button, and the last five runs with what
each one found. It reads `job-runs` rather than GitHub, because there is no GitHub run to read.

**What step 1 turned up once it was live.**

Two bugs, neither in the job. The first shadow run computed the right answer and then failed to
record it: `execute.ts` builds its run with every key set, so a successful run passes
`detail: undefined`, and Firestore rejects `undefined` outright. `record` swallowed the throw — a job
that did its work must not be reported failed because the bookkeeping failed — so the page said "No
runs recorded yet" about a run that had worked perfectly. The second was that `handicaps` names both
the workflow and the job, deliberately, and both endpoints redirected with `?ran=<slug>`; the job's
notice would have claimed presses of the workflow's button. Jobs now report through `ranJob`.

Separately, the job was scanning the observation log **four times** per run — twice of its own and
twice inside a writer that re-read the collection to find what was missing. At 1,400 observations and
four runs a day that was 23,000 Firestore reads against a free tier of 50,000, and about 39,000 a
year from now. One scan costs 6,000 a day. That was a bug rather than a property of the design, and
it would have surfaced as a bill rather than an error.

**The paired decision arrived on 2026-09-18, and the two pipelines agreed.** On the 05:00 UTC tick:

| | Time | Verdict |
| --- | --- | --- |
| The job (shadow) | 05:00:35Z | `sami-h` 4.8 → 5.2, recorded in `job-runs` |
| `update-handicaps.yml` | 05:01:06Z | `Sami H: 4.8 -> 5.2`, committed to `handicaps.json` |

Thirty-one seconds apart, same player, same pair of numbers, and — the part that makes it evidence
rather than a coincidence — the job read `handicaps.json` *before* the workflow wrote it, so it
reached that answer without being told it. The ordering argued for above is not merely implemented;
it has now been observed doing its job on a real change.

Two days of ticks either side of it reported `0 changes`, which is the correct answer on a day
nothing moved: the 07:00 tick that followed already had the workflow's commit to reconcile, agreed
with it, and found nothing to do. No runaway, no double-count.

**The run log across the whole shadow period**, read from `job-runs` on 2026-09-18: fourteen runs
retained, thirteen `ok` and one `failed`. Every one of the eight *scheduled* runs succeeded. The
failure was a local development run on 2026-09-16 19:21 UTC, recorded against
`someone-else@example.com` — the dev IAP stand-in's account — which means an admin on a laptop was
pointed at production Firestore rather than the emulator. Worth knowing because it is the one way
this collection can be written by hand, and because it is not a fault in anything this plan builds:
run the admin with `FIRESTORE_EMULATOR_HOST` set and it cannot happen.

### Step 2 — live writes ✅ *done 2026-09-18*

Flip `dryRun` off. Firestore and the NDJSON backup both become real, with the append-only guard
armed. `handicaps.json` is still the build input and still written by the old workflow, so the two
pipelines now genuinely race for the same truth — which is the comparison this transition is for.

**Acceptance criterion**, written down now because "confident the data matches" does not survive
contact with a Tuesday: for every `(player, date)`, `latestPerDay` over the NDJSON equals
`latestPerDay` over `handicaps.json`; the NDJSON is a superset; and every extra row is explainable as
a second reading the old schedule missed.

That last clause was written as the risky one, on the grounds that **no `(player, date)` pair in the
entire 1,406-entry history has more than one reading** and multiple readings a day were days old
as a capability. The 2026-09-18 change settles it, in an unexpected direction: *the dual-run manufactures
the double reading itself, on every change, and will keep doing so for as long as both pipelines
run.*

The two pipelines stamp the same reading at the moment each of them takes it — 05:00:35Z for the job,
05:01:06Z for the workflow — and the document id is `${player}_${date}_${observed}`. So once `dryRun`
is off, one handicap moving produces **two** documents: the job's own scrape, and the workflow's row
reconciled in on the following tick. Same player, same date, same value, thirty-one seconds apart.

This is good news for the criterion rather than bad, and it is worth being precise about why:

- `latestPerDay` sorts on `date` then `observed` and keeps the last, and both rows carry the same
  handicap — so it returns 5.2 either way. **The first clause holds.**
- The NDJSON gains a row `handicaps.json` does not have. **The second clause holds**, and the extra
  row is explainable — just not by the explanation the plan anticipated. It is not the Union
  publishing twice; it is our own two pipelines reading once each.

The consequence to carry into the comparison: expect the NDJSON to run **exactly one row ahead per
change**, permanently, rather than to match row for row. Anyone diffing counts rather than
`latestPerDay` will see a drift that is correct and looks like a bug. The capability the plan called
untested is now exercised on every single change, which is a better rehearsal than waiting for the
Union to publish twice would have been.

**What the first real run did.** Started by hand from `/operations` at 2026-09-18 08:27:26Z and
finished twelve seconds later, `outcome: ok`, `dryRun: false`, commit
[`d52f44f`](https://github.com/hectorgolf/hector.golf/commit/d52f44f606cff9deea059d08ce833102d8c57994).
It reconciled the whole committed history into Firestore, rendered it, and created
`data/handicaps/observations.ndjson` at 1,408 lines, authored `hector-admin <noreply@hector.golf>`
with the message "Reconcile the handicap observation log".

Run against production, the criterion above passes on every clause:

| | |
| --- | --- |
| NDJSON rows | 1,408 |
| `handicaps.json` entries | 1,408 |
| Documents in `handicap-observations` | 1,408 |
| NDJSON a superset of `handicaps.json` | yes |
| `latestPerDay` identical across both | yes, all 1,408 pairs |
| Rows in the NDJSON and not in `handicaps.json` | 0 |

Three things this settled that nothing before it could.

**The token's `Contents: write` scope works.** `push: True` said the grant existed; until this commit
nothing had ever used it, and a wrong scope would have surfaced here as a failed run rather than
earlier. It did not.

**The backup's new home keeps the deploys down.** No `deploy-site.yml` run followed the commit — the
last one was 08:03, from a workflow dispatched by hand. Moving the file out of `astrosite/` in
step 2 rather than step 3 is why a change still costs one deploy.

**The row drift has not started yet, and that is correct.** The run found `changes: 0`: it
reconciled git's rows in, scraped, and WiseGolf agreed with every one of them, so the job wrote no
observation of its own. The +1 begins at the next handicap that moves, when the job stamps
`observed` before the workflow stamps a later one. Live mode has therefore not yet exercised the
double-reading case — the shadow period is where the evidence for it came from, and the first real
change is where it should be checked again.

### Step 3 — move the reader, once ✅ *done 2026-09-18*

The build fetches `/api/handicaps/history`, with the committed backup as a credential-less fallback.
The rule matters more than the mechanism:

- **No credentials at all** — a fork, a pull request from a fork, a laptop, `check-site.yml` — read
  the committed backup and print a loud notice. This is what keeps
  [`data-ownership.md`](../current/data-ownership.md)'s "a fork can still build it" true where it
  actually matters.
- **Credentials present but the fetch fails** — fail the build. Never silently publish stale data on
  the real deploy path.

~~The backup moves to `data/handicaps/observations.ndjson`~~ — **done in step 2 instead.** The move
was planned here because that is when the reader stops needing the file where the site can see it.
It happened a step early for a better reason: until step 2 the file did not exist, so changing the
path cost nothing, where doing it afterwards would have meant migrating a committed file and an
append-only guard pointed at the wrong history. Moving it also removed the extra deploys step 2
would otherwise have caused, which is what prompted it.

The endpoint dispatches `deploy-site.yml` when anything changed, which it already knows how to do.

**What it took, and the one thing that decided the shape.** The site's accessors are synchronous and
called from `.astro` templates inside `.map()` callbacks and from the middle of `events.ts`, so an
async reader would have turned a data-source change into a rewrite of every call site. The history is
resolved once in a top-level await instead and the accessors are untouched; the module graph does the
sequencing, and a failure there is a failed build, which is what the rule above wants.

Three rules were added that the plan had not written down, each because the alternative fails
quietly. A **half-configured** build fails rather than falling back, since setting one of the two
variables is a statement that this deploy was wired to the API and answering a typo with the backup
is the same silent stale publish by another route. An **empty** answer fails the build though it is
a valid 200 at the endpoint — the endpoint cannot tell an empty store from one nobody has filled,
and a build of this site can. And the backup is imported with `?raw` rather than read with
`node:fs`, which keeps the module isomorphic and makes a missing backup a build error instead of an
empty history.

**Jobs can now ask for a deploy.** Moving the backup out of `astrosite/` in step 2 stopped its
commits publishing the site, which was right while nothing built from it and wrong the moment
something did. Jobs carry `publishes`, and one that does dispatches `deploy-site.yml` when it found
changes — *changes*, not "it committed something", because the reconcile tick commits rows the site
is already showing and deploying for those would restore the three-per-change count that moving the
file removed.

**Verified end to end on 2026-09-18.** The deploy that followed the merge ran the WIF step rather
than skipping it, printed no fallback notice, built 328 pages, and published a `sami-h` page carrying
the 5.2 observed that morning. A build that had failed to reach the API would have gone red instead,
by design.

### Step 4 — retire the old workflow

Only after `player.handicap`, `handicap-checks.json` and `event.buckets` have a new home. See the
table above.

**`handicap-checks.json` has one, as of 2026-09-18.** It went through steps 1 to 3 in a single move,
because by then the harness existed and the pattern had been run twice: `handicap-checks` in
Firestore, `data/handicaps/checks.ndjson` as the backup, `/api/handicaps/checks` for the build. Two
differences from the observation log are worth knowing. It is NDJSON where the old file was a JSON
array, and not for tidiness — the append-only guard is line-oriented, so a JSON array cannot be
guarded at all. And it is written by the *handicaps* job rather than one of its own, because a check
records that scrape; a separate job would have to sweep WiseGolf again to have anything to say.

**The remaining two are not the same kind of problem**, and it is worth saying so here rather than
discovering it halfway:

`player.handicap` may not need moving at all. Since step 3 the site resolves a handicap as
`player.handicap ?? latest-from-the-history`, and the history is now a fetch away — so the stored
field is load-bearing only when the history has nothing, which is exactly the stopgap case it was
invented for. The move is therefore to **stop CI writing it**, not to relocate the writer, which
resolves the ownership conflict in [`data-ownership.md`](../current/data-ownership.md) instead of
carrying it somewhere else. The admin's roster was the one reader that would lose by that, and as of
2026-09-18 it reads `handicap-snapshots/latest` — one document holding every player's latest
handicap, rebuilt from the whole history on every run, so a page load costs one read rather than a
scan of fourteen hundred.

`event.buckets` is genuinely blocked, and not on this plan. Buckets are written into event documents,
and Firestore holds hector events as a *mirror the admin reads* rather than as their source — so a
job writing buckets there puts a scheduled writer and an unsynchronised export on the same documents,
which is the conflict the rule quoted under *Why* exists to prevent. Handicaps escaped that rule
because nobody authors a handicap; events do not escape it, because people author them. It needs the
editor half of the pair, which is a different plan. Splitting it out would leave step 4 waiting on one
thing instead of three.

Two things break quietly in this step if they are not done with it:

- [`refresh-admin-mirror.yml`](../../.github/workflows/refresh-admin-mirror.yml) triggers on
  `workflow_run` **by display name**. A renamed or deleted workflow means it silently never fires
  again.
- [`data-formatting.test.ts`](../../astrosite/test/unit/data-formatting.test.ts) asserts that
  `src/data/handicaps.json` exists and that there are more than 60 data files.

## Decisions

**Authentication is IAP, not an API key.** The service runs with `iap_enabled = true` and only the
IAP service agent holds `roles/run.invoker`, so a request that did not come through IAP never reaches
the process. An API key in a header would be checked by nothing and would not get past IAP anyway.

**The document id is `${player}_${date}_${observed ?? "unstamped"}`.** Entries carry no id of their
own, and everything written before 2026-09-14 has no `observed`. This key is unique across all 1,406
existing entries — the old code de-duplicated per day, so unstamped entries are unique per
`(player, date)` — and step 0's replay test asserts it rather than assuming it.

**`handicap-observations`, not `handicap-changes`.** The codebase is emphatic that this is a log of
observations rather than of days or changes: `compareObservations`, `observationsOn`, and the schema
comment in [`handicaps.ts`](../../packages/schemas/src/handicaps.ts). `changes` is vocabulary this
deliberately moved away from.

**`fetch`, not Octokit, inside the admin.** [`github.ts`](../../admin/src/lib/github.ts) documents the
decision not to take the dependency for two calls. This adds two more — get contents, put contents —
which does not obviously flip it. Note that `astrosite` *does* use Octokit, in
`code/leaderboards/github.ts`, so the precedent exists if the count ever grows.

**A PAT's pushes trigger workflows.** Unlike `GITHUB_TOKEN`, whose recursion guard is the entire
reason `request-deploy` exists. So anything this service commits under `astrosite/**` fires
`deploy-site.yml` by itself — which is why the backup is not kept there.

This was first written as "a second deploy per change", to be tolerated until step 3. Two corrections
followed, and the second removed the problem rather than describing it. The count was wrong: a tick
that saw a change would have cost **three** deploys where one is right — the job's commit, the
workflow's dispatch, and the job's commit again on the next tick, when it reconciles the workflow's
row and the render grows rather than matching. That third one is the `observed`-stamp asymmetry a
second time, and it is the one the original note missed.

Rather than tolerate three, step 2 put the backup at `data/handicaps/observations.ndjson` from the
start. Nothing builds from that file, so nothing should redeploy for it, and the cost of the move was
zero at a moment when the file had never been written. A change therefore still costs exactly one
deploy: the workflow's, dispatched explicitly, the same as before any of this began.

**Nothing serialises the admin's commit against the workflows.** The Contents API needs the blob SHA,
so a race is a 409 rather than corruption — but it needs refetch-and-retry, and the render must be
deterministic (order by `date`, `observed`, `player`) or it will commit phantom diffs.

**Nothing serialises the two deploys either, and one direction of that is unsafe.** A merge that both
adds an endpoint to the admin *and* teaches the site to read it starts `deploy-admin` and
`deploy-site` at the same moment. They are separate workflows with separate durations; neither waits
for the other. The site build can therefore reach an admin that is still serving the previous image,
ask for a route it does not have, and get a 404.

This is not hypothetical. It happened on 2026-09-18 at 17:34, when the sweep-log change landed as one
commit: `deploy-site` asked for `/api/handicaps/checks` and was refused, the build failed, and the
site stayed on a build from seven hours earlier until the next deploy.

The failure was the designed one — a build with credentials that cannot reach the API fails rather
than publishing the backup as though it were current — so nothing wrong was published, and the cost
was staleness rather than a lie. That is the direction to be wrong in, and it is why the mitigations
below are about avoiding a red build rather than about avoiding a bad one.

The race only exists in one direction. Deploying the admin *first* is always safe: an endpoint nobody
reads yet harms nothing. So the rule is the expand-then-contract one every producer/consumer split
across two deploy units has: **ship the endpoint, let it deploy, then ship the reader.** Two merges,
no machinery, and the only thing it costs is remembering.

Three further mitigations were considered. Which of them is worth building depends on how often this
shape recurs, and with three scrapes still to move it will recur:

- **A readiness wait in `deploy-site`.** Before building, ask the admin for the routes this build
  needs and wait — a couple of minutes at most — for them to answer. `deploy-admin` takes about a
  minute, so a wait absorbs the race rather than reporting it, and a healthy deploy pays one request.
  This is the only one of the three that turns the failure into a delay.
- **A clearer message on 404 specifically.** The build already names the URL and the status; a 404
  could add "is `deploy-admin` still running?". It fixes the diagnosis, not the failure, and the
  diagnosis was not the slow part.
- **Falling back to the backup when the fetch fails.** Rejected, and worth writing down so that it
  stays rejected: it is the third branch `admin-api.ts` deliberately does not have. It would convert
  every occurrence of this into a silent publication of stale handicaps, which is the outcome the
  whole asymmetry exists to prevent. A red deploy is the cheap failure here.

Worth knowing either way: a failed deploy is not permanent. `deploy-site` carries
`cadence: { every: '1d' }` in `workflows.ts`, so the tick republishes within a day even if nobody
notices, and any data change dispatches it sooner.

## Consequences for the docs

Landing step 2 makes [`data-ownership.md`](../current/data-ownership.md) wrong in two tables — both
say `handicaps.json` is not in Firestore — and step 3 makes its "the site build stays hermetic"
paragraph a statement about the fallback rather than about the build. `architecture.md` §9 and its
workflow inventory both describe the old pipeline. None of this is optional tidying: those documents
are the reason anyone can reconstruct why this looks the way it does.

## The alternative, and why this one was taken

The same destination reached in one move instead of four — every dataset at once, all 89 committed
JSON files deleted, the site built from an API — is written up and implemented in
[PR #145](https://github.com/hectorgolf/hector.golf/pull/145). It is a draft, and deliberately not
merged: the document lives on that branch rather than here, because a plan nobody is following is
better read next to the code that would carry it out.

Two things it turned up are worth knowing even though it was not taken, because both apply to this
plan's later steps.

**A schema that lags its data is a delete, not a waste, once the files are gone.** Thirteen of the
seventeen course files carried fields the course schema did not mention, and a migration that stored
the parsed record would have dropped them permanently. Fixed on `main` since, and
`course-schema-coverage.test.ts` now pins it — but the lesson generalises to every collection this
plan eventually moves.

**`src/data/` had two readers, and the second failed silently.** Deleting the directories emptied
the Astro content collections, and nothing failed: `astro check` passed, the build passed, and it
produced 77 pages instead of 328. A successful deploy of an empty site is the worst outcome available
to any of this, and nothing in the toolchain objects to it.
