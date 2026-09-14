# Documentation

Three kinds of document, kept in three directories, because the difference decides how you read one.

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
| [`functions-migration.md`](plans/functions-migration.md) | Moving the four Cloud Functions out of `gen-lang-client-0537211409` into `hector-golf` | **Nearly.** Phases 1–6 and 8 done 2026-09-14; phase 7 waits until 2026-09-21 |
| [`sheets-credential-wif.md`](plans/sheets-credential-wif.md) | Retiring the last downloadable service account key, in favour of Workload Identity | **Partly.** Phases 1–5 applied 2026-09-14; phase 6 waits until 2026-09-21 |

A partly-executed plan is the case the lifecycle below does not cover, and both of these are now in
it: neither is finished, neither is untouched, and what each is waiting on is a calendar rather than
a decision. They come due the same day, 2026-09-21 — `sheets-credential-wif.md` phase 6 and
`functions-migration.md` phase 7, both of which delete a credential a week after the thing that
replaced it went live. Leave them in `plans/` until then, then make the move-or-delete call on both.
The column is what keeps them honest in the meantime.

## [`playbooks/`](playbooks/) — how to do a thing, again

Procedural, and unlike a plan, **running one does not use it up**. A playbook stays valid after it
has been followed, because the next person will need it too.

| | |
| --- | --- |
| [`gcp-bootstrapping.md`](playbooks/gcp-bootstrapping.md) | Taking an empty GCP project to a working, CI-deployed admin service. The disaster-recovery procedure |
| [`local-gcp-identities.md`](playbooks/local-gcp-identities.md) | Running things locally as the right GCP identity, without a browser round trip every time you switch |

That distinction is the reason for a third directory rather than filing playbooks under `plans/`. A
plan is finished when it has been executed and becomes misleading if left in place; a playbook is
finished when it is accurate, and is *supposed* to sit there unused.

## The lifecycle

A plan lives in `plans/` until it has been run. Then one of two things happens to it, and the choice
is worth making deliberately rather than leaving the file where it is:

- **It describes how things now are** — move it to `current/` and rewrite the phases as description.
  A plan left in `plans/` after execution is the most misleading document in the repository, because
  its tense says the opposite of the truth.
- **It was scaffolding** — delete it, and fold whatever is still true into `architecture.md`. The
  pull request that executed it is the record of how it was done.

## Where the outstanding work is

Not here. [`../README.md`](../README.md) is the backlog — the list of things somebody decided to do
next. A `current/` document that finds itself growing a "what to do about this" section is a sign
that section belongs in the backlog, or that the whole document belongs in `plans/`.

Two of these documents had exactly that problem when this split was made. `data-ownership.md`
proposed two fields that do not exist, and `gcp-bootstrapping.md` ended with four next steps of
which two were still outstanding. Both are now in the backlog as well, so `current/` can be read as
description without checking whether each paragraph is a promise.
