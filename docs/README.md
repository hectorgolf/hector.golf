# Documentation

Four kinds of document, kept in four directories, because the difference decides how you read one.

## [`current/`](current/) — how things are

Descriptive. If one of these disagrees with the code, the document is wrong and wants fixing.

| | |
| --- | --- |
| [`architecture.md`](current/architecture.md) | The whole system: layers, data model, pipeline, CI. §13 is a register of known gaps and drift |
| [`data-ownership.md`](current/data-ownership.md) | Who wins when CI and a human write the same field |
| [`gcp-setup.md`](current/gcp-setup.md) | What is running in `hector-golf`, and which of it cannot be changed |
| [`handicap-updates.md`](current/handicap-updates.md) | How a handicap reaches this repository, and why two can share a day |

## [`plans/`](plans/) — what has not happened yet

Prescriptive. A plan describes a system that does not exist yet, in whole or in part — so the
"executed?" column is the first thing to read, because a plan that is partly done is the one that
will mislead you.

| | | executed? |
| --- | --- | --- |
| [`authoring-players-and-events.md`](plans/authoring-players-and-events.md) | Moving players and Hector events from the mirrored column to the owned one, and giving each an editor — the one piece of work the other two are waiting on | **Step 1,** on 2026-09-21. Players are authored in the admin: both scheduled writers moved into this service, both workflows are deleted, the files are named after their ids and there is an editor. Step 2 is Hector events and is not to be attempted in the week of a Hector. Finnkampen was the pilot and is now out of scope |
| [`courses-in-the-admin.md`](plans/courses-in-the-admin.md) | The seventeen golf courses: into Firestore, rendered, and eventually editable | **Steps 1-3,** on 2026-09-21. Tee names normalised, courses seeded as a mirror with a synthetic id per tee, and read-only pages behind the `Courses` nav entry that used to say `planned`. What is left is an editor and the flip, which is cheap here because no scheduled writer has ever touched these files |
| [`biography-locking.md`](plans/biography-locking.md) | `player.biographyLocked`, so the twice-monthly regeneration stops overwriting edited biographies | **Mostly,** on 2026-09-19. The field exists, the generator skips a locked player, logs who it left alone and still shows the model their text so a rewrite cannot echo it; it is set by editing the player file. What is left is setting it from the admin when somebody saves an edit, and a **Regenerate** that clears it, blocked on players being authorable there at all |
| [`bucket-locking.md`](plans/bucket-locking.md) | `event.bucketsLocked`, so an announced split can be settled before the first morning | **Mostly,** on 2026-09-18. The field exists, the handicaps job honours it and the payload publishes it; it is set by editing the event file. What is left is setting it from the admin, blocked on Hector events being authorable there at all |

The two locking plans came out of `current/data-ownership.md`, which specified both fields as part
of a decision that was otherwise a description of how things already are. A proposal in a
descriptive document is read as description by everybody who did not write it, which is how two
fields that did not exist came to be documented beside seven that did. Both now exist, and
`data-ownership.md` describes them rather than proposing them.

A partly-executed plan is the case the lifecycle below does not cover, and two files are in it.
Both were trimmed to what has *not* happened on 2026-09-19, so each answers three questions and
stops: what to do, why it is worth doing, and what has to be removed first. What the executed part
did, and what each step of it cost, is in git history and in `current/` — keeping it in the plan
made both files read as records, which is the one thing a prescriptive document must not do.

Two of the three are waiting on the same thing: the admin can author matchplay events and nothing
else, so Hector events and players are mirrored from the committed files and anything written to the
mirror is reverted by the next `npm run seed`. Until that changes, a bucket lock cannot be set from
the admin and neither can a biography lock. That one piece of work is the third plan,
[`authoring-players-and-events.md`](plans/authoring-players-and-events.md), which is written the
other way round from its two dependants: they each describe a small piece of UI, and it describes
the ownership transfer underneath them all.

`handicaps-to-firestore.md` was a fourth, and was listed here as waiting on the same thing until it
turned out not to be. Its last step was deleting `update-handicaps.yml`, blocked on `event.buckets`
— and that blocker was about writing buckets to *Firestore*, where a scheduled writer would race the
export. Writing them to **git** instead is the same write the workflow was already making, from a
different process, and it leaves the ownership rule untouched. The workflow went on 2026-09-20 and
the plan went with it: the pull requests that executed it are the record, and what survives is in
[`architecture.md`](current/architecture.md) §8 and
[`handicap-updates.md`](current/handicap-updates.md).

The lesson is worth keeping even though the file is not. A blocker is worth re-reading before it is
inherited: this one had been restated in three plans and a `current/` document, and was true of one
implementation rather than of the problem.

**And one plan here was never executed at all.**
[`everything-to-firestore.md`](plans/everything-to-firestore.md) proposed moving all 89 data files
into Firestore at once and deleting them from git. It was not taken — the incremental route was, and
is most of what the other plans here are — and it is kept because it was *built* before it was
rejected. The comparison at the end of it is worth something for exactly that reason: it is a
measured alternative rather than an imagined one.

It lived on its own branch until 2026-09-21, which made it invisible to anybody who did not already
know the branch existed. The document is here now and the implementation is in
[PR #145](https://github.com/hectorgolf/hector.golf/pull/145), whose refs GitHub keeps after a
branch is deleted. Neither a plan nor a lesson should depend on somebody remembering not to tidy a
branch up.

`functions-migration.md` and `sheets-credential-wif.md` were the awkward sort, because what they
were waiting for was a date rather than a decision — both on the same calendar, a credential
deleted a week after its replacement went live. Both are gone as of 2026-09-19, the last credential
in the old project with them, and both left the same way: nothing in either was still true and not
recorded closer to the code, so the pull requests that executed them are the record. What survived
them is in [`gcp-setup.md`](current/gcp-setup.md) — including two dated notes that can be pruned
once their own recovery windows close.

One of the two is worth remembering as a lesson rather than a file. `sheets-credential-wif.md`
ended with a parting note — a filter in `update-leaderboards.ts` commented out, "it wants a home in
`current/` before this file goes" — which was the right instinct and, by the time anyone came to
act on it, already out of date: the filter was restored on 2026-09-18. A plan that names its own
loose ends is doing the reader a service, and checking those ends against the code before deleting
the file is what stops the service becoming a fiction.

`dev-server-in-process.md` left the other way, on 2026-09-18, and is the worked example of the
second branch of the lifecycle. Its phase 1 was executed and is described in
[`current/architecture.md` §11](current/architecture.md#11-local-development-and-operations) and in
the header of `admin/scripts/dev-iap.ts`, which is also where its phase 2 question — whether the
proxy hop earns its keep — is now answered as a description rather than asked as a plan. Nothing was
left in the file that was not a second copy of something else, so it was deleted rather than moved.

## [`experiments/`](experiments/) — what was built and not adopted

Descriptive, like `current/`, but about the parts of the system that do nothing. An experiment is
deployed code with no caller: it exists, it runs, and nothing depends on it.

| | | verdict |
| --- | --- | --- |
| [`player-avatar-generation.md`](experiments/player-avatar-generation.md) | `GeneratePlayerAvatar` — a cartoon headshot from a photograph | **Not adopted.** Uniformity across arbitrary source photos was never good enough |
| [`scorecard-extraction.md`](experiments/scorecard-extraction.md) | `ExtractScorecardInformation` — a scorecard screenshot read into typed scores | **Not adopted.** Accuracy never convinced us; three prompt generations, the third unfinished |

Both are Cloud Functions, both deploy on every push to `main`, and neither is called by a workflow,
by the site, or by the Admin UI. They were in `current/architecture.md` §10 until 2026-09-15, which
is what this directory was made to fix. That section opened by dividing the four functions into
"three Gemini wrappers and a proxy", gave three of four table rows to Gemini, and spent its only
deep dive on the prompts — two of the three belonging to functions nobody calls. It read as a
description of an AI backend. The running system is a leaderboard proxy and a biography writer.

`experiments/README.md` says what each of these files owes you, and the fourth item on that list is
the one that matters: what would have to be true to adopt it, or to delete it. An experiment nobody
can state a resumption condition for is a deletion waiting to be approved.

## [`playbooks/`](playbooks/) — how to do a thing, again

Procedural, and unlike a plan, **running one does not use it up**. A playbook stays valid after it
has been followed, because the next person will need it too.

| | |
| --- | --- |
| [`gcp-bootstrapping.md`](playbooks/gcp-bootstrapping.md) | Taking an empty GCP project to a working, CI-deployed admin service. The disaster-recovery procedure |
| [`local-gcp-identities.md`](playbooks/local-gcp-identities.md) | Running things locally as the right GCP identity, without a browser round trip every time you switch |

That distinction is the reason for a separate directory rather than filing playbooks under
`plans/`. A plan is finished when it has been executed and becomes misleading if left in place; a
playbook is finished when it is accurate, and is *supposed* to sit there unused.

## The lifecycle

A plan lives in `plans/` until it has been run. Then one of two things happens to it, and the choice
is worth making deliberately rather than leaving the file where it is:

- **It describes how things now are** — move it to `current/` and rewrite the phases as description.
  A plan left in `plans/` after execution is the most misleading document in the repository, because
  its tense says the opposite of the truth.
- **It was scaffolding** — delete it, and fold whatever is still true into `architecture.md`. The
  pull request that executed it is the record of how it was done.

An experiment leaves `experiments/` the same way and for the same reason: adopted, its description
moves into `current/` and the file goes; abandoned, the code and the file are deleted together. The
failure mode is identical in both directories — a file whose tense says the opposite of the truth.

## Where the outstanding work is

Not here. [`../README.md`](../README.md) is the backlog — the list of things somebody decided to do
next. A `current/` document that finds itself growing a "what to do about this" section is a sign
that section belongs in the backlog, or that the whole document belongs in `plans/`.

Two of these documents had exactly that problem when this split was made. `data-ownership.md`
proposed two fields that do not exist, and `gcp-bootstrapping.md` ended with four next steps of
which two were still outstanding. The first is now two plans of its own, and the second is in the
backlog, so `current/` can be read as description without checking whether each paragraph is a
promise.
