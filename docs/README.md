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
| [`biography-locking.md`](plans/biography-locking.md) | `player.biographyLocked`, so the twice-monthly regeneration stops overwriting edited biographies | **No.** The field is in no schema, page or script |
| [`bucket-locking.md`](plans/bucket-locking.md) | `event.bucketsLocked`, so an announced split can be settled before the first morning | **No,** and it argues with itself about whether it should be. Read its last section first |
| [`handicaps-to-firestore.md`](plans/handicaps-to-firestore.md) | Moving the handicap scrape out of a GitHub Actions runner writing JSON, and into the admin writing Firestore — and the job harness the three scrapes behind it will reuse | **Steps 0 and 1.** The job has shadowed `update-handicaps.yml` on every scheduled tick since 2026-09-16. Step 2, live writes, is next and is the one with a deadline |
| [`functions-migration.md`](plans/functions-migration.md) | Moving the four Cloud Functions out of `gen-lang-client-0537211409` into `hector-golf` | **All but one step.** Phases 1–6 and 8 done 2026-09-14, the old functions deleted 2026-09-17. Only the old Gemini API key is left |
| [`sheets-credential-wif.md`](plans/sheets-credential-wif.md) | Retiring the last downloadable service account key, in favour of Workload Identity | **Yes,** all six phases on 2026-09-14. Kept only for two items that expire 2026-10-14 — a deleted account's undelete window and an orphaned key — and deletable after that |

The two locking plans came out of `current/data-ownership.md`, which specified both fields as part
of a decision that was otherwise a description of how things already are. A proposal in a
descriptive document is read as description by everybody who did not write it, which is how two
fields that do not exist came to be documented beside seven that do.

A partly-executed plan is the case the lifecycle below does not cover, and two files are in it.
`handicaps-to-firestore.md` is the ordinary sort: a migration with steps, halfway through them, and
it records under each step what that step cost. The column and the ticks in the file say where it
is.

`functions-migration.md` is the awkward sort, because what it is waiting for is a date. Both it and
`sheets-credential-wif.md` were waiting on the same calendar — a credential deleted a week after its
replacement went live — and both stopped waiting early once the evidence was in:
`sheets-credential-wif.md` phase 6 went on the day phase 5 verified green, and the old functions
went on 2026-09-17 after three days of silence rather than seven. What is left of
`functions-migration.md` is one API key, so it stays in `plans/` until that is deleted and then
takes the move-or-delete call on its own. The column is what keeps it honest in the meantime.

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
