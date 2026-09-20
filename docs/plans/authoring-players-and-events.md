# Authoring players and events in the admin

*No ownership has moved. The admin still authors matchplay events and nothing else; players, Hector
events and Finnkampen events are mirrors it reads, refreshed from the committed files by
`npm run seed`. This is the one piece of work [`docs/README.md`](../README.md) says unblocks the two
plans behind it.*

*What landed on 2026-09-20 was the reading half, and part of it was taken away again the same day.
Players and Hector events have pages in the admin now — a list and a record page each, read-only on
purpose. Finnkampen got the same pair and lost it; see "Not in scope". Nothing below is executed by
any of that. What it changes for whoever starts this:*

- ***Step 0 is done**, reads and writes both. The guards are in and `PLAYERS_ARE_OWNED` is the one
  edit that flips them; see the step, which is now a pointer rather than a task list.*
- *Every page says why it cannot be edited, from `lib/mirror.ts`, which derives the answer from
  `OWNED_FORMATS`. Moving a format into that set removes its notice; there is no second list to
  remember.*
- *The read-only fields are the form's fields with the inputs taken out, sharing `admin.css`'s label
  rule. Making one editable is replacing a `<p>` with an `<input>` and putting a `<form>` round the
  section.*
- *Step 1 is players and step 2 is Hector, which is not the order this plan was written in. Losing
  Finnkampen cost it its pilot; the reordering, and what it costs, are under the price table.*
- *Two findings came out of building those pages, and both are recorded where they belong rather
  than only here. Twenty participant ids in the committed events match no player document — all
  eighteen of `FINNKAMPEN2022`'s and two in `HECTOR2017` — and step 2 inherits the Hector pair
  ([`architecture.md`](../current/architecture.md) §13). And the seed/export round trip turns out to
  be clean for every event file, which "Before each flip" now records as measured rather than
  expected.*

## What to do

Move `players/` and `events/hector/` out of the mirrored column and into the owned one —
[`data-ownership.md`](../current/data-ownership.md) — and give each an editor in the admin.

`events/finnkampen/` is the third mirrored collection and is deliberately not a step; see "Not in
scope".

## Why

Two plans are stopped on the same sentence. [`bucket-locking.md`](./bucket-locking.md) cannot offer
a lock the next seed reverts, and [`biography-locking.md`](./biography-locking.md) cannot set one on
save for the same reason. Each is a small piece of UI waiting on the same structural change, which is
why they are worth doing as one plan rather than two.

A third was listed here and is not any more. `handicaps-to-firestore.md` could not retire
`update-handicaps.yml` while `event.buckets` had nowhere to go — except that its recompute never
needed the mirror to become the source. It writes buckets to **git**, which is the same write the
workflow was already making, so the ownership rule is untouched and the workflow was deleted on
2026-09-20. That is worth knowing here rather than only in its history: a plan blocked on this one
is worth re-reading before it is counted, because "the admin cannot write this record" is true of
Firestore and not of the repository.

Underneath that, today every one of these records is edited by opening a JSON file and committing
it. That is a reasonable way to run thirteen events and forty-five players and a bad way to run a
tournament week, when the person who needs to add a late replacement is at a golf course.

## The work is ownership, not forms

The reflex is to read this as "build two more editors". The editors are the smaller half. Firestore
already holds every one of these documents, and `admin/src/lib/repository/events.ts` already reads
them — the Events landing page counts thirteen Hector events out of the store today. What is missing
is the right to *write* them, and that right is not granted by adding a form. It is granted by moving
the collection between two lists in `admin/src/lib/ownership.ts`, which changes what `npm run export`
publishes and what `npm run seed` overwrites.

[`data-ownership.md`](../current/data-ownership.md) states the rule that sets the cost:

> A collection moves into the exported column on the day the admin can author it **and** its
> scheduled writer has been moved to Firestore. Those two things have to happen together: either one
> alone recreates the conflict in the other direction.

So the price of each collection is the number of scheduled writers that have to move, not the number
of fields on its form:

| Collection | Records | Scheduled writers to move | Unblocks |
| --- | --- | --- | --- |
| `events/finnkampen/` | 2 | **none** — hand-edited, no job touches it | nothing |
| `players/` | 45 | `update-player-biographies` (`biography`), `update-player-club-memberships` (`club`) | biography-locking |
| `events/hector/` | 13 | `update-leaderboards` (`results.teams`) — the handicaps job writes `buckets` to git already | bucket-locking |

That table used to set the order by itself: Finnkampen had no scheduled writer, so it was the pilot
— two events from 2021 and 2022, nothing at stake, every mechanism step 0 widens exercised once on
data where being wrong costs a revert of two files. Its pages were removed from the admin on
2026-09-20 because the format is not fully implemented anywhere, and owning a collection nobody can
look at is not a pilot but an exercise. It is still in the table because it is still mirrored; it is
no longer a step. See "Not in scope".

So the order is now a choice between the two that are left, and it is decided by a date rather than
by the table.

## Step 0 — done, on 2026-09-20

Every mechanism that enforces ownership named matchplay explicitly, because matchplay was all there
had ever been. They ask `admin/src/lib/ownership.ts` now — `saveEvent` and `deleteEvent` in place of
the matchplay-shaped pair, a `savePlayer` and `deletePlayer` that refuse while `PLAYERS_ARE_OWNED`
is false, the export's empty-set refusal covering players, and a `--bootstrap` guard that walks both
collections rather than only `events`. Nothing changed behaviour, which is what made it landable on
its own. What each one refuses is described in
[`data-ownership.md`](../current/data-ownership.md#the-two-scripts-are-complements); what it cost is
in the pull request.

Two things came out of doing it that the steps below inherit.

**Flipping `PLAYERS_ARE_OWNED` is now one edit**, and it is the only edit those five mechanisms
need. It is emphatically not the whole flip — the two scheduled writers still have to move first,
which is most of step 1 — but the day they have, nothing else has to be found.

**The export cannot compose a player's file path.** Not one of the forty-five files is named after
the id it holds, so it globs and matches on the id inside each file, the way `playerDataPath()`
already did on the site's side. The first version composed `players/{id}.json`, which against an
emulator wrote forty-five new files and removed all forty-five real ones — the empty-set guard does
not catch that, because the store was not empty. A player created in the admin, which cannot happen
until step 1 builds an editor, gets the composed name — and step 1 is where that stops being a
special case, because it renames the files. See below.

## Step 1 — players

First because of the calendar, not because it is the easy one.

Hector events are the better candidate on every other axis: one writer to move against two, thirteen
records against forty-five, an editor whose read-only half is already built, and — the part that
matters most — the machinery step 0 widens is *event* machinery, which players do not exercise at
all. What rules them out is the date in step 2. `HECTOR2026` is played 2026-09-24 to 2026-09-27, and
this document has said since it was written not to make that flip in the week of a Hector. Waiting
for the winter before starting anything would stall the two plans behind this one for a season.

So players go first, and the cost of that ordering is worth writing down rather than discovering:

Two of the three costs this ordering had are gone, because step 0 paid them in advance rather than
leaving them to the flip: the seed's players line is gated and its `--bootstrap` guard covers both
collections, and the export's empty-set refusal covers players. Both were verified against an
emulator with the flag flipped. One cost is left.

- **The generic event save path gets no shakedown flight.** `saveEvent` behind an `OWNED_FORMATS`
  refusal, the export covering a second format, the seed dropping a format, a deletion guard that is
  no longer a format literal — none of that is exercised by owning players, so all of it first runs
  against Hector events in step 2, which is the collection this document least wants to be wrong
  about. `admin/test/repository-events.test.ts` is the only thing exercising it until then, which is
  why it covers the refusal from both sides rather than only the happy path.

Two halves, in this order, and the second cannot land without the first.

### Move the two writers into the service

Both write through `updatePlayerData`, which persists the whole player object — so both are
whole-record writers, and both have to stop writing files before the admin can own one.

They move the way the handicap scrape did: into `admin/src/lib/jobs/`, registered in
`registry.ts`. Both are in, in shadow, as of 2026-09-20 — `club-memberships` decides *and* scrapes,
`biographies` decides only, and neither writes. Neither is on the tick: the club scan is 140
requests per player and the biographies run will eventually be forty-five model calls, so both are
started by hand. That harness was built for exactly this.
Its header says so — entries move from `workflows.ts` to `JOBS` one dataset at a time, and a dataset
appears in both lists during the migration, which is what `dryRun` is for. Use the shadow period;
the handicaps job is the precedent for how long it needs to be, and for why "a week of boring diffs"
turned out to be the wrong unit — one pair of decisions made against the same base state proved more
than a week of waiting would have.

Neither job needs anything the service has not already got:

- **Club memberships** scrape WiseGolf, and `@hector/wisegolf` plus `wisegolfCredentials` in
  `secrets.ts` are already what the handicaps job uses. The rule this job implements — assign `club`
  only when the field is empty — is the authored rule, arrived at independently, and it does not
  change.
- **Biographies** call the `GeneratePlayerBiography` Cloud Function over HTTP, which a Cloud Run
  service can do as readily as a runner. The shadow job deliberately does not: the decision is the
  half that can be wrong silently, and generating forty-five biographies to throw away is the half
  that costs a model call each. It also does not solve `refreshClubsJson()`, which is this
  workflow's *second* output and has to find a home before the workflow can be deleted — the same
  shape as `update-handicaps.yml`'s four. [`biography-locking.md`](./biography-locking.md) records
  that this job's import-time blocker is already gone: `golfClubs` was a module-level IIFE that
  scraped WiseGolf and rewrote `clubs.json` on import, it is now fetched lazily, and `run()` only
  fires when the script is executed. So the admin can import what it needs.

`clubs.json` was answered on 2026-09-20 and the answer was no. It is refreshed by a `clubs` job in
the admin, at most every 30 days, and committed to git — so `update-player-biographies.yml` is down
to one output and can be retired when the biographies move. The file is kept rather than deleted
although no code reads it: it is the only list of valid club abbreviations here, and the player
editor below wants it for a club picker. It is derived, has no human writer and nothing authors
it — the third arrangement `data-ownership.md` describes, where the file stays committed and the
collection never joins the exported column.

The club job's writer landed on 2026-09-20 and is waiting on the flag rather than on work.
`savePlayer` does the writing, `PLAYERS_ARE_OWNED` is the only gate, and a run today reports what it
would have assigned and says why it did not. The biographies job has no writer and cannot have one
yet: generating needs the admin to hold `astrosite-api-key`, which is a Secret Manager grant and a
`terraform apply` rather than code.

### Then own the collection, and build the editor

The fields and their affordances are already specified, in "What the admin UI owes this". They are
not free choices, and three of them are easy to get backwards:

- **`handicap` is a stopgap, not an override.** The box is editable and has to say that WiseGolf will
  replace the value as soon as it has one, because someone who reads it as an override will read the
  replacement as their edit being lost. No player is in that state today; a new member with no
  WiseGolf record is one signup away from it.
- **Saving a biography sets `biographyLocked`.** Not a checkbox beside the text — saving the edit
  *is* the act of taking the field over, and a lock somebody forgets to tick is indistinguishable
  from no lock at all on the day the job next runs. An explicit **Regenerate** clears it and re-runs
  generation for that one player, which is what makes the lock safe to set: without it, locking a
  biography locks it for good. That is all of `biography-locking.md`, and it lands here.
- **Regenerate needs single-player generation, which does not exist yet.** `generateBiography` is
  reachable only from a whole-roster run, and the roster is also what supplies the "do not reuse this
  phrasing" context. A single-player regeneration has to decide what to hand it — the same question
  step 2 of that plan answered in the other direction.

`misc` and `club` are plainly authored and want nothing but a text field. Player **images** are files
on disk, not in Firestore, and are not in scope as *content* — the editor should say so rather than
offering an upload that goes nowhere. Their filenames are in scope; see below.

### And rename the files, in the same step

**Decided 2026-09-20: `players/first-last.json` becomes `players/first-l.json`, matching the id, as
part of this step and not before it.**

Step 0 left the export discovering a player's file by matching the id inside it, because not one of
the forty-five is named after the id it holds. That works, it is what `playerDataPath()` already
does, and the round trip is clean — so the rename buys no capability. What it buys is symmetry:
events compose `events/{format}/{id}.json` and match, players would too, and the question of what a
newly-created player's file is called answers itself.

The reason to do it *here* rather than earlier is who is reading the directory. Until this step
there is no player editor, so the person fixing a club abbreviation opens the file by hand, and
`lasse-koskela.json` is the better name for that. The day the admin becomes the primary writer,
human filenames stop earning their keep and the machine-readable ones start.

Three things come with it, and none is hard as long as they are not discovered one at a time:

- **The forty player images** under `players/images/originals/` are named `first-last.jpeg`. Nothing
  reads them — [`architecture.md`](../current/architecture.md) §13 — but leaving them puts two
  sibling directories on different conventions, which is the kind of thing that reads as an
  oversight rather than a decision.
- **`astrosite/test/unit/player-data-paths.test.ts` exists to forbid exactly this**: its whole
  argument is that a writer composing a path from an id writes to the wrong file. Once names match
  ids that argument stops holding, so the test is rewritten or deleted deliberately — not left to
  fail and be patched.
- **`dev-fake.ts` picks its WiseGolf stand-in roster** by sorting filenames and taking the first
  twenty-four, so the rename quietly changes which players drift locally. Harmless, and worth a line
  in the commit so the next person does not go looking for a cause.

Afterwards the export can compose the path and drop `playerPathsById()`, and `data-ownership.md`'s
note about discovery goes with it.

## Step 2 — Hector events

The largest step, the one with a date on it, and — now that Finnkampen is not a step — the one
that first exercises everything step 0 widened. Do not run it in the week of a Hector.

`HECTOR2026` is played 2026-09-24 to 2026-09-27. Its buckets are recomputed on every tick until 08:00
on the first morning, which is precisely the window in which a mistake in the ownership flip is
least recoverable and most visible — the Draft after round one is decided by the split, and
`bucket-locking.md` exists because a split that changes overnight is discovered on the tee. The
handicap season stops in October. Land this after the event is played, with the winter to test it in.

### Move the two writers

- **`event.buckets` is already done, and did not need this plan.** The admin's handicaps job
  recomputes every open split and commits the event JSON to git, which deleted
  `update-handicaps.yml` on 2026-09-20. What is left for this step is only to stop *that* writer
  being a git writer once Hector events are owned in Firestore — a smaller change than the move was,
  and one with a working implementation to read.
- **`event.results.teams` moves out of `update-leaderboards.ts`, and nothing else does.** That
  workflow has two outputs and only one of them touches an event document. `leaderboards/*.json` has
  no Firestore copy and no human writer, so it stays exactly where it is and the workflow stays with
  it. Saying that is what keeps this step from becoming a fourth job migration: the back-fill is one
  guarded assignment — CI writes teams only when there are none — and it needs a home in the service,
  not a rewrite.

### Then own the collection, and build the editor

This is the only editor where the form is genuinely large, and the recommendation is to build less of
it than the schema has.

Details, the field, courses and buckets are worth structured forms. **Rounds and game formats are
not**, and the honest reason is how often they change: a Hector's rounds are written once a year, in
the winter, by the person who also maintains `gameFormatSchema`. A form over that schema means ten
format names, handicap allowances, per-competition contributions, team-contribution modes, two bonus
fields and a conditional opening-shots rule that is only valid for Scrambles — a week of work used
twice a year. A textarea holding the `rounds` array, parsed through `hectorEventSchema` before it is
saved and re-shown with the errors when it fails, costs a day and is honest about who edits it. The
matchplay edit page already does the re-show-what-was-typed half.

`bucketsLocked` goes in beside the bucket editor, not ahead of it. That is what
[`bucket-locking.md`](./bucket-locking.md) asks for, and its reasoning is worth keeping: the lock
alone protects a split CI computed, and the pair is what lets somebody fix one.

## Before each flip

Per collection, in the same commit:

1. Its last scheduled writer no longer writes the committed file.
2. It is in `OWNED_FORMATS` (or the players equivalent), so the export covers it and the seed skips
   it.
3. The guards from step 0 cover it — the empty-set refusal and the bootstrap refusal both. They
   do, for players and for every format, since 2026-09-20; this is a thing to confirm rather than to
   build.

And one acceptance test worth naming, because it is cheap and it catches the whole class of problem
at once: **seed a clean emulator from the committed files, export, and `git diff --exit-code`.** A
round trip that is not a no-op differs for one of two reasons — schema defaults being materialised,
or key order — and both want settling as their own commit *before* the flip, so that the first real
export is not a thirteen-file diff with one real change hidden in it.

**Run on 2026-09-20, and it is clean — for events.** This document used to say the result was
expected and worth showing; it has now been shown. With every format put into `OWNED_FORMATS`
temporarily, the export reported `hector: 13 exported, 0 changed`, `matchplay: 3 exported, 0
changed` and `finnkampen: 2 exported, 0 changed`, and `git diff --exit-code` over
`astrosite/src/data/events/` passed. So the defaults `data-ownership.md` warns the first export
makes explicit are already explicit in all eighteen files, and key order survives the round trip.
That is one fewer thing for step 2 to find out the hard way.

**Players are clean too, as of 2026-09-20.** They were not covered when this was first run, because
`export.ts` had no players path at all; step 0 added one, gated on `PLAYERS_ARE_OWNED`, for exactly
this reason — without it the first person to own players would have been discovering schema defaults
and key order in the same change that moves two scheduled jobs. With the flag flipped the export
reported `players: 45 exported, 0 changed, 0 removed` and the diff was empty, so none of the
optional fields no committed file sets — `gender`, `privacy`, `aliases`, `image`, `misc`,
`biographyLocked` — is materialised on the way through. `biographyLocked` is the undefaulted
optional `data-ownership.md` argues about at length, and it stays absent.

Run it against the emulator, which needs no code change:
`FIRESTORE_EMULATOR_HOST=localhost:8432 npm run seed -- --bootstrap`, then `npm run export`.

## What gets riskier, and is not addressed here

**One press of Export publishes more.** The export is manual on purpose — "an export publishes
whatever is in the store at that moment", and a schedule would eventually publish a bracket drawn
but not yet corrected. That reasoning holds, but the button currently publishes three tournaments
and would publish sixty-one — the three, plus forty-five players and thirteen Hector events.
Whether the operations page should say how many documents have been authored since the last export
is a real question and a small one; it is not a blocker.

**Authorization is still a type.** `identity.ts` declares `Permission` with `events:write` and
`players:write` and exports `can()`; nothing calls it and nothing grants a permission. Everyone IAP
admits can do everything. That is a defensible position for one developer and one allowlist, and it
is the position today — but the surface behind it grows from three tournaments to forty-five players
and thirteen Hector events, so it should be a decision somebody makes rather than a thing nobody
noticed.

## Not in scope

- **Courses.** `planned` in `sections.ts`, and a genuinely different problem: they are not
  in Firestore at all and no job writes them, so the work is an import plus an editor with no
  ownership conflict anywhere in it. Cheaper than either step above, and independent of all of it.
- **Splitting the data loader** so the site can read Firestore. In the backlog
  ([`../../README.md`](../../README.md)); nothing here needs it, because the site keeps building from
  committed files that are now generated.
- **Player images**, which are files on disk and want their own decision.
- **Finnkampen.** Still mirrored, still authored by editing two committed files, and no longer a
  step in this plan. It was step 1 until 2026-09-20, as the pilot — no scheduled writer, nothing at
  stake — and the admin's read-only pages for it were removed that day on the grounds that the
  format is not fully implemented anywhere: the public site has no route for it either, so the admin
  had become the only place two events nobody maintains were rendered.

  Owning it is still the cheapest flip in this document, and it stays that way: no writer to move,
  two files, one entry in `OWNED_FORMATS` and one in `EVENT_FAMILIES`. What it now lacks is a
  reason. The generic event editor it would have piloted is built by step 2 regardless, so the day
  somebody actually wants to edit a Finnkampen event, this is an afternoon on top of a finished
  step 2 rather than a step anybody has to plan around. The removed pages are whole in
  `git log -- admin/src/pages/events/finnkampen`.
