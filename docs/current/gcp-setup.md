# The GCP project

*Describes `hector-golf` as it stands. Last reviewed: 2026-09-14, after the Cloud Functions moved
in.*

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
| Eight service accounts | Two runtime identities (the admin service, and the functions), one for Terraform in CI, two for app deploys (the admin, and the functions), one the function builds run as, one for the scheduled data updates, and one that reads the leaderboard spreadsheets. The last holds no project roles at all; the functions' runtime holds none either, only read on three secrets |
| Cloud Run services for four Cloud Functions | `ExtractScorecardInformation`, `GeneratePlayerBiography`, `GeneratePlayerAvatar`, `TournamentLeaderboard`. Gen2 functions *are* Cloud Run services. CI deploys them; Terraform owns their identities, their secrets and the `allUsers` binding that makes them public, but deliberately not the functions themselves |
| Workload Identity Federation pool | Keyless GitHub Actions auth — no service account keys anywhere |
| Four Secret Manager secrets | `github-dispatch-token` for the admin, and `gemini-api-key`, `astrosite-api-key` and `hector-app-api-key` for the functions. Terraform creates every container and never a value — those go in by hand with `gcloud secrets versions add` |
| Two Cloud Scheduler jobs | Start the data-update workflows on time, because GitHub's own cron runs hours late. Every two hours from 03:00 to 07:00 UTC, covering the early-tee-time window, and once at 12:00. Two jobs, not six: Scheduler bills per job per month, not per execution. In `europe-west1`, not `europe-north1` — Cloud Scheduler does not run there |
| Billing budget (optional) | Alerts above €2/month |

And four workflows: [`terraform-plan.yml`](../../.github/workflows/terraform-plan.yml) on pull
requests, [`terraform-apply.yml`](../../.github/workflows/terraform-apply.yml) on merge to `main`,
[`deploy-admin.yml`](../../.github/workflows/deploy-admin.yml), and
[`deploy-functions.yml`](../../.github/workflows/deploy-functions.yml). All four federate through the
one Workload Identity pool, as separate identities.

## What is deliberately not here

- **The public site.** `hector.golf` remains a static Astro build on GitHub Pages, deployed by
  the existing [`deploy-site.yml`](../../.github/workflows/deploy-site.yml). Nothing here touches it.
- **The Cloud Function resources themselves.** The four functions moved into this project on
  2026-09-14 and are listed above, but no `google_cloudfunctions2_function` describes them: CI
  deploys them wholesale with `gcloud`, because shipping a new version must not require a
  `terraform apply`. Terraform owns everything around them — the APIs, the three identities, the
  secret containers, and the `allUsers` binding in
  [`cloud_run.tf`](../../terraform/cloud_run.tf) — which is the same division as the admin service.
- **The four *old* copies** of those functions, still running in `gen-lang-client-0537211409` until
  they are deleted on 2026-09-21. Nothing points at them.
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

There are in fact two live budgets, and only the first is about this project:

| Budget | Scope | Amount | Thresholds |
| --- | --- | --- | --- |
| `hector.golf - alert above EUR 2/month` | `hector-golf` only | €2/month | 50%, 100%, 200% of current spend |
| `Billing account - alert above EUR 4/month` | whole billing account, no project filter | €4/month | 100% of current spend, 100% of forecast |

The second is a backstop, and it stays outside `terraform/` on purpose: its scope is the billing
account, which is expected to outlive this stack and eventually hold others. A stack that owned it
would either have to be the permanent home of every future project's alerting, or hand it over
later. Its ceiling is deliberately above the per-project budget beneath it, so routine `hector-golf`
spend cannot trip it — an account-wide budget set *below* a project budget alarms during normal
operation and trains you to ignore it, which is what the earlier €1 version did.

What it cannot see is creep. It catches a project spiking, not a forgotten project burning a steady
couple of euros, because that never reaches the ceiling. The per-project budgets are what close
that gap, and only `hector-golf` has one.

If you edit either budget with `gcloud billing budgets update`, check the JSON it prints back.
`--add-threshold-rule` documents `percent` as "integer between 0 and 100" but passes the value
straight into an API field that is a fraction, so `percent=100` stores `100.0`, meaning 10000% —
an alert that never fires. `percent=1` is 100%.

## Where the outstanding work is

Not here. [`../../README.md`](../../README.md) is the backlog. Two of the four "next pieces" this
project was set up for — migrating `handicaps` and the player images into Firestore, and splitting
the data loader — are still open, and are tracked there.
