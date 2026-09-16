# Moving the handicap scrape into Firestore

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

**If the live comparison is wanted, step 1 needs to be running by early October.** Most of the
validation does not need to wait, which is what makes a short window survivable:

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

### Step 0 — prerequisites

None of these need the season, a deploy, or a decision.

- `packages/wisegolf/`: lift `handicap-source-api.ts`, `wisegolf-api.ts` and `http-helpers.ts` out of
  `astrosite/src/code/handicaps/`. Two other workflows already import them, so this pays for itself
  before the admin uses it at all.
- WiseGolf credentials in Secret Manager, with an accessor binding for `admin_runtime`. Following the
  existing rule in [`secrets.tf`](../../terraform/secrets.tf): Terraform creates the container and
  never the value, and the container spec never names a secret version.
- `secrets.ts` generalised past its single hardcoded GitHub token.
- The GitHub token gains `Contents: read and write`. Note the consequence in *Decisions* below.
- Firestore: `handicap-observations`, `job-runs`, `job-locks`.
- The offline replay test: 1,406 committed entries → Firestore documents → rendered NDJSON, asserted
  equal to today's `handicaps.json` under `latestPerDay`.

### Step 1 — shadow

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

Watch the run log until the diffs are boring.

### Step 2 — live writes

Flip `dryRun` off. Firestore and the NDJSON backup both become real, with the append-only guard
armed. `handicaps.json` is still the build input and still written by the old workflow, so the two
pipelines now genuinely race for the same truth — which is the comparison this transition is for.

**Acceptance criterion**, written down now because "confident the data matches" does not survive
contact with a Tuesday: for every `(player, date)`, `latestPerDay` over the NDJSON equals
`latestPerDay` over `handicaps.json`; the NDJSON is a superset; and every extra row is explainable as
a second reading the old schedule missed.

That last clause is the interesting one, and it is close to untested: **no `(player, date)` pair in
the entire 1,406-entry history has more than one reading**, and `observed` exists on nine entries,
all written on 2026-09-14. Multiple readings a day are days old as a capability. The case most likely
to make the two stores disagree has never actually happened.

### Step 3 — move the reader, once

The build fetches `/api/handicaps/history`, with the committed backup as a credential-less fallback.
The rule matters more than the mechanism:

- **No credentials at all** — a fork, a pull request from a fork, a laptop, `check-site.yml` — read
  the committed backup and print a loud notice. This is what keeps
  [`data-ownership.md`](../current/data-ownership.md)'s "a fork can still build it" true where it
  actually matters.
- **Credentials present but the fetch fails** — fail the build. Never silently publish stale data on
  the real deploy path.

The backup moves to `data/handicaps/observations.ndjson`: out of `deploy-site.yml`'s path filter, so
the admin decides when to deploy, and out of the Prettier-ignored `astrosite/src/data/` tree, so it
needs adding to [`.prettierignore`](../../.prettierignore) in the same commit.

The endpoint dispatches `deploy-site.yml` when anything changed, which it already knows how to do.

### Step 4 — retire the old workflow

Only after `player.handicap`, `handicap-checks.json` and `event.buckets` have a new home. See the
table above.

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
reason `request-deploy` exists. So the admin committing under `astrosite/**` fires `deploy-site.yml`
by itself, and during step 2 that is a second deploy per change. Step 3 moves the file out of the
path filter, which resolves it.

**Nothing serialises the admin's commit against the workflows.** The Contents API needs the blob SHA,
so a race is a 409 rather than corruption — but it needs refetch-and-retry, and the render must be
deterministic (order by `date`, `observed`, `player`) or it will commit phantom diffs.

## Consequences for the docs

Landing step 2 makes [`data-ownership.md`](../current/data-ownership.md) wrong in two tables — both
say `handicaps.json` is not in Firestore — and step 3 makes its "the site build stays hermetic"
paragraph a statement about the fallback rather than about the build. `architecture.md` §9 and its
workflow inventory both describe the old pipeline. None of this is optional tidying: those documents
are the reason anyone can reconstruct why this looks the way it does.

## The alternative

[`everything-to-firestore.md`](./everything-to-firestore.md) is the same destination reached in one
move instead of four, for every dataset at once. It is worth reading before starting this one, if
only to be able to say why not.
