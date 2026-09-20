# Authoring players and events in the admin

*No ownership has moved. The admin still authors matchplay events and nothing else; players, Hector
events and Finnkampen events are mirrors it reads, refreshed from the committed files by
`npm run seed`. This is the one piece of work [`docs/README.md`](../README.md) says unblocks the two
plans behind it.*

*What did land, on 2026-09-20, is the reading half: all three collections now have pages in the
admin — a list and a record page each — and they are read-only on purpose. Nothing below is
executed by that. What it changes for whoever starts this:*

- *Part of **step 0** is done. `repository/events.ts` has a generic `getEventOfFormat` and
  `listEventsOfFormat`, and a `getPlayer`. The write side — `saveEvent` behind an `OWNED_FORMATS`
  refusal, `savePlayer`, `deletePlayer`, and the three guards in `export.ts` and `seed.ts` — is
  untouched, and it is the half that carries the risk.*
- *Every page says why it cannot be edited, from `lib/mirror.ts`, which derives the answer from
  `OWNED_FORMATS`. Moving a format into that set removes its notice; there is no second list to
  remember.*
- *The read-only fields are the form's fields with the inputs taken out, sharing `admin.css`'s label
  rule. Making one editable is replacing a `<p>` with an `<input>` and putting a `<form>` round the
  section.*
- *It surfaced one thing steps 1 and 3 inherit: twenty participant ids in the committed events match
  no player document — all eighteen of `FINNKAMPEN2022`'s, and two in `HECTOR2017`. A participant
  picker cannot offer an id no collection has. Recorded in
  [`architecture.md`](../current/architecture.md) §13.*
- *The Finnkampen pages went again the same day, deliberately — see step 1, which now creates them
  rather than adding a form to them. Hector and players kept theirs.*

## What to do

Move `events/finnkampen/`, `players/` and `events/hector/` out of the mirrored column and into the
owned one — [`data-ownership.md`](../current/data-ownership.md) — and give each an editor in the
admin.

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
it. That is a reasonable way to run thirteen events and forty-six players and a bad way to run a
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
| `players/` | 46 | `update-player-biographies` (`biography`), `update-player-club-memberships` (`club`) | biography-locking |
| `events/hector/` | 13 | `update-leaderboards` (`results.teams`) — the handicaps job writes `buckets` to git already | bucket-locking |

Finnkampen having no scheduled writer is the useful accident in that table, and it sets the order
below.

## Step 0 — generalise the machinery, before anything is owned

Every mechanism that enforces ownership names matchplay explicitly, because matchplay is all there
has ever been. Widening them is a change with no behavioural effect on its own, which makes it the
one step that can land and sit.

- **`repository/events.ts` is matchplay-shaped on the write side.** The reads were generalised on
  2026-09-20 — `getEventOfFormat` and `listEventsOfFormat` take the format, and `getMatchplayEvent`
  and `listMatchplayEvents` are one-line callers of them. `saveMatchplayEvent` and
  `deleteMatchplayEvent` still hardcode it. They want a `saveEvent` that validates through
  `genericEventSchema` and **refuses a format not in `OWNED_FORMATS`**. The refusal is the important
  half rather than the generalisation: it is the ownership rule expressed as code instead of as a
  document, and it is what stops a page written for one format from writing a mirrored one. The
  existing guard in `deleteMatchplayEvent` is the model — it reads the document first so that the
  wrong id is a no-op.
- **There is no player writer at all.** `listPlayers` and `getPlayer` read; nothing saves. A
  `savePlayer` behind the same ownership check, and a `deletePlayer`, are new.
- **`export.ts` refuses to export an empty owned set, for events only.** That guard exists because an
  empty read deletes every committed file of the formats it covers — "a very fast way to lose them to
  a misconfigured database id". Players need their own copy of it, or the same typo removes
  forty-six player files instead.
- **`seed.ts`'s bootstrap guard reads the `events` collection and nothing else.**
  `refuseToOverwriteAuthoredEvents` walks `events`, parses each document and refuses if an owned one
  was last written by someone other than `seed`. The day players are owned, `--bootstrap` reverts
  every authored player with no refusal and no output. This is the most dangerous single gap in the
  plan, because the failure is silent and the script that causes it is the one you reach for
  legitimately — the seed's own header already names that trap for the matchplay case.
- **`seed.ts` writes players unconditionally.** The format loop respects `MIRRORED_FORMATS`, so an
  event format moving out of the mirror needs no change here. The players line does not: it sits
  outside that loop and is gated on nothing. `refresh-admin-mirror.yml` runs the seed unattended
  after every scrape, so left as it is, the day players are owned they are reverted about twelve
  times a day.

`admin/test/ownership.test.ts` exists and is where the invariant belongs: the owned and mirrored sets
are complements, and neither script covers a collection the other does.

## Step 1 — Finnkampen, as the pilot

Move `EventFormat.Finnkampen` into `OWNED_FORMATS`, export it, and build the generic event editor
against it.

Nothing is at stake. Two events, played in 2021 and 2022, no scheduled writer, and no page anybody
checks daily. That is the whole reason to start here: every mechanism step 0 widened gets exercised
once — the generic save path, the export covering a second format, the seed dropping a format, a
non-matchplay event page, a deletion guard that is no longer a format literal — on data where being
wrong costs a revert of two files.

Nobody needs to edit Finnkampen. The step is not for Finnkampen's sake, and it should not be
justified to a reader as though it were.

**This step creates the Finnkampen pages; it does not add a form to one.** They existed, read-only,
for a day — added on 2026-09-20 and removed the same day, on the grounds that the format is not
fully implemented anywhere and the admin had become the only place two events nobody maintains were
rendered. That is a reason to remove a read-only view and not a reason against this step: the
argument above is about what Finnkampen is *worth risking*, which is nothing, and that is unchanged.
It does mean the step is a little larger than the other two, and that the removal commit is where to
start reading — `git log -- admin/src/pages/events/finnkampen` has both pages whole.

The editor itself is mostly assembly, and more of it exists than the deletion suggests.
`EventDetailsFields.astro` covers name, location, the date pair and the description for every format,
because those live on `BaseEventSchema`, and `EventDetailsView.astro` is the same fields read-only,
in the same order, for exactly this swap — the Hector page still uses both halves, so neither has
rotted. `Participants.astro` renders a field for any format and is where the unresolved-id count
above comes from; the add and remove half is what it does not have. `Roster.astro` is still typed to
`MatchplayEvent` and reads a handicap snapshot it only needs during signup; that handicap column
should not follow it into a finished 2021 event, which is why the read-only field table leaves it
out. What is new is `results` — named teams and their players — and that is the shape Finnkampen and
Hector share.

Add the family back to `EVENT_FAMILIES` in `sections.ts`, as `editable`, in the same change. A nav
entry that says Finnkampen is coming, after it has arrived, is the same lie in the other direction —
and `test/sections.test.ts` fails on one half of it already: a family is `editable` only where
`OWNED_FORMATS` would accept the write. Two other things key off that list and will start answering
differently the moment the family returns, which is the point of their existing —
`adminPathForEvent()` starts linking Finnkampen appearances on a player's page, and `eventMirror()`
stops explaining why the format cannot be edited once it is in `OWNED_FORMATS`.

The site is a separate question this step does not settle. `siteVisibility()` in
`admin/src/lib/events/site.ts` will still answer "no route", correctly, because
`astrosite/src/pages/events/` has no `finnkampen/[slug].astro` — authoring an event in the admin
does not publish one.

## Step 2 — players

Two halves, in this order, and the second cannot land without the first.

### Move the two writers into the service

Both write through `updatePlayerData`, which persists the whole player object — so both are
whole-record writers, and both have to stop writing files before the admin can own one.

They move the way the handicap scrape did: into `admin/src/lib/jobs/`, registered in
`registry.ts`, run by the same Cloud Scheduler tick. That harness was built for exactly this.
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
  service can do as readily as a runner. [`biography-locking.md`](./biography-locking.md) records
  that this job's import-time blocker is already gone: `golfClubs` was a module-level IIFE that
  scraped WiseGolf and rewrote `clubs.json` on import, it is now fetched lazily, and `run()` only
  fires when the script is executed. So the admin can import what it needs.

Whether `clubs.json` follows the players into Firestore is a separate question and the answer is
probably no. It is derived, has no human writer and nothing authors it — the third arrangement
`data-ownership.md` describes, where the file stays committed and the collection never joins the
exported column.

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
on disk, not in Firestore, and are not in scope — the editor should say so rather than offering an
upload that goes nowhere.

## Step 3 — Hector events

The largest step, and the one with a date on it. Do not run it in the week of a Hector.

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
3. The guards from step 0 cover it — the empty-set refusal and the bootstrap refusal both.

And one acceptance test worth naming, because it is cheap and it catches the whole class of problem
at once: **seed a clean emulator from the committed files, export, and `git diff --exit-code`.** A
round trip that is not a no-op differs for one of two reasons — schema defaults being materialised,
or key order — and both want settling as their own commit *before* the flip, so that the first real
export is not a fifteen-file diff with one real change hidden in it.

It is expected to be close to clean already. All thirteen Hector files carry `ignore` and
`maxStrokesOverPar`, and both Finnkampen files carry `ignore`, so the defaults `data-ownership.md`
warns the first export makes explicit are explicit in these files today. Expected, not assumed —
this is a thing to show.

Run it against the emulator, which needs no code change:
`FIRESTORE_EMULATOR_HOST=localhost:8432 npm run seed -- --bootstrap`, then `npm run export`.

## What gets riskier, and is not addressed here

**One press of Export publishes more.** The export is manual on purpose — "an export publishes
whatever is in the store at that moment", and a schedule would eventually publish a bracket drawn
but not yet corrected. That reasoning holds, but the button currently publishes three tournaments
and would publish sixty-two records. Whether the operations page should say how many documents have
been authored since the last export is a real question and a small one; it is not a blocker.

**Authorization is still a type.** `identity.ts` declares `Permission` with `events:write` and
`players:write` and exports `can()`; nothing calls it and nothing grants a permission. Everyone IAP
admits can do everything. That is a defensible position for one developer and one allowlist, and it
is the position today — but the surface behind it grows from three tournaments to forty-six players
and thirteen Hector events, so it should be a decision somebody makes rather than a thing nobody
noticed.

## Not in scope

- **Courses.** Marked unavailable in `sections.ts`, and a genuinely different problem: they are not
  in Firestore at all and no job writes them, so the work is an import plus an editor with no
  ownership conflict anywhere in it. Cheaper than either step above, and independent of all of it.
- **Splitting the data loader** so the site can read Firestore. In the backlog
  ([`../../README.md`](../../README.md)); nothing here needs it, because the site keeps building from
  committed files that are now generated.
- **Player images**, which are files on disk and want their own decision.
