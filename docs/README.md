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

Prescriptive, and **none of these has been executed**. A plan describes a system that does not exist.

| | |
| --- | --- |
| [`functions-migration.md`](plans/functions-migration.md) | Moving the four Cloud Functions out of `gen-lang-client-0537211409` into `hector-golf` |
| [`sheets-credential-wif.md`](plans/sheets-credential-wif.md) | Retiring the last downloadable service account key, in favour of Workload Identity |

## [`playbooks/`](playbooks/) — how to do a thing, again

Procedural, and unlike a plan, **running one does not use it up**. A playbook stays valid after it
has been followed, because the next person will need it too.

| | |
| --- | --- |
| [`gcp-bootstrapping.md`](playbooks/gcp-bootstrapping.md) | Taking an empty GCP project to a working, CI-deployed admin service. The disaster-recovery procedure |

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
