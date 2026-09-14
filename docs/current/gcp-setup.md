# The GCP project

_Describes `hector-golf` as it stands. Last reviewed: 2026-09-14._

What is running in Google Cloud, and which of it cannot be changed. For the procedure that builds
this from an empty project — whether for a second environment or to recover from losing this one —
see [`../playbooks/gcp-bootstrapping.md`](../playbooks/gcp-bootstrapping.md).

The two documents were one until they were separated: a runbook that is followed perhaps twice in a
project's life was the only record of what that project *is*, which meant reading eleven numbered
steps to answer "what is deployed".

## What is running

Everything in [`terraform/`](../../terraform/) describes it, and CI applies it:

| Resource | What it is for |
| --- | --- |
| Firestore database, Enterprise edition | The data store. `europe-north1`, native mode, PITR on, delete-protected |
| Artifact Registry repository | Admin service container images, with cleanup policies |
| Cloud Run service `hector-admin` | The admin UI and API, scaled to zero, IAP in front of it |
| Five service accounts | One runtime identity, one for Terraform in CI, one for app deploys, one for the scheduled data updates, and one that reads the leaderboard spreadsheets — the last holding no project roles at all |
| Workload Identity Federation pool | Keyless GitHub Actions auth — no service account keys anywhere |
| Secret Manager secret `github-dispatch-token` | The GitHub token the admin dispatches workflows with. Terraform creates the container; step 11 adds the value |
| Two Cloud Scheduler jobs | Start the data-update workflows on time, because GitHub's own cron runs hours late. Every half hour from 03:00 to 07:30 UTC, covering the early-tee-time window, and once at 12:00. Two jobs, not ten: Scheduler bills per job per month, not per execution. In `europe-west1`, not `europe-north1` — Cloud Scheduler does not run there |
| Billing budget (optional) | Alerts above €2/month |

And three workflows: [`terraform-plan.yml`](../../.github/workflows/terraform-plan.yml) on pull
requests, [`terraform-apply.yml`](../../.github/workflows/terraform-apply.yml) on merge to `main`, and
[`deploy-admin.yml`](../../.github/workflows/deploy-admin.yml), which stays inert until an `admin/`
directory exists.

## What is deliberately not here

- **The public site.** `hector.golf` remains a static Astro build on GitHub Pages, deployed by
  the existing [`deploy.yml`](../../.github/workflows/deploy.yml). Nothing here touches it.
- **The four existing Cloud Functions** in the old project (`GeneratePlayerBiography`,
  `GeneratePlayerAvatar`, `ExtractScorecardInformation`, `TournamentLeaderboard`). They are still
  deployed by hand from a laptop via the npm scripts in
  [`backend/backend-functions/package.json`](../../backend/backend-functions/package.json). Importing
  them is worthwhile eventually and is not on the path to a working admin UI. See
  [§13 of the architecture notes](./architecture.md).
- **The Terraform state bucket**, which cannot describe itself. Step 2 creates it by hand; it is the
  one piece of infrastructure not in `terraform/`.


## The decisions you cannot take back

| Decision | Why it is permanent |
| --- | --- |
| Firestore `location_id` | Cannot be changed after provisioning. Moving means a new database and a data migration |
| Firestore `type` | Same |
| Firestore `database_edition` | Same. `STANDARD` → `ENTERPRISE` has a documented migration path; the reverse does not |
| Which database got the free tier | The first one created in the project keeps it |

Everything else in `terraform/` can be changed by editing it and re-applying.


## The two things Terraform does not own

Both are deliberate, and both are the kind of thing that looks like an oversight to whoever finds
them next.

**The state bucket** cannot describe itself — Terraform cannot create the bucket its own state lives
in. It is created by hand, and it is the one piece of infrastructure with no representation in
`terraform/`. The bootstrapping playbook's step 2 is where it comes from.

**The billing budget** is described in [`budget.tf`](../../terraform/budget.tf) but is off by
default, and the live budget is created with a `gcloud` command instead. Switching it on halfway is
worse than either end state, because CI reads a different value than a laptop does and plans to
destroy a budget it cannot even refresh. The playbook's step 9 has the full table of what each
setting does.

## Where the outstanding work is

Not here. [`../../README.md`](../../README.md) is the backlog. Two of the four "next pieces" this
project was set up for — migrating `handicaps` and the player images into Firestore, and splitting
the data loader — are still open, and are tracked there.
