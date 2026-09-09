# Setting up hector.golf on a fresh GCP project

_Last reviewed: 2026-09-10_

This is the runbook for taking an empty Google Cloud project to a working, CI-deployed admin
service with a Firestore database behind it. It exists because the previous GCP setup was clicked
together by hand and could not be rebuilt, and because three of the decisions below cannot be
undone once made.

Follow it top to bottom. It takes about half an hour, most of which is waiting for API enablement.

## What this builds

Everything in [`terraform/`](../terraform/):

| Resource | What it is for |
| --- | --- |
| Firestore database, Enterprise edition | The data store. `europe-north1`, native mode, PITR on, delete-protected |
| Artifact Registry repository | Admin service container images, with cleanup policies |
| Cloud Run service `hector-admin` | The admin UI and API, scaled to zero, IAP in front of it |
| Three service accounts | One runtime identity, one for Terraform in CI, one for app deploys |
| Workload Identity Federation pool | Keyless GitHub Actions auth — no service account keys anywhere |
| Billing budget (optional) | Alerts above €1/month |

And three workflows: [`terraform-plan.yml`](../.github/workflows/terraform-plan.yml) on pull
requests, [`terraform-apply.yml`](../.github/workflows/terraform-apply.yml) on merge to `main`, and
[`deploy-admin.yml`](../.github/workflows/deploy-admin.yml), which stays inert until an `admin/`
directory exists.

## What this deliberately does not build

- **The public site.** `www.hector.golf` remains a static Astro build on GitHub Pages, deployed by
  the existing [`deploy.yml`](../.github/workflows/deploy.yml). Nothing here touches it.
- **The four existing Cloud Functions** in the old project (`GeneratePlayerBiography`,
  `GeneratePlayerAvatar`, `ExtractScorecardInformation`, `TournamentLeaderboard`). They are still
  deployed by hand from a laptop via the npm scripts in
  [`backend/backend-functions/package.json`](../backend/backend-functions/package.json). Importing
  them is worthwhile eventually and is not on the path to a working admin UI. See
  [§13 of the architecture notes](./architecture.md).
- **The Terraform state bucket**, which cannot describe itself. Step 2 creates it by hand; it is the
  one piece of infrastructure not in `terraform/`.

## Before you start

You need the `gcloud` CLI, Terraform 1.9 or newer, and `Owner` (or equivalent) on the project. Set
your shell up once:

```bash
export PROJECT_ID=hector-golf
export REGION=europe-north1
export BUCKET="${PROJECT_ID}-tfstate"
gcloud config set project "$PROJECT_ID"
```

### Check the free-tier database first

This matters more than it looks. Only **one** Firestore database per project gets the no-cost
quota — Google's wording is that "the first database that is created in a project without a free
tier database will get the free tier". If something has already created a database in this project,
the one Terraform creates will have no free quota at all and you will not be told.

```bash
gcloud firestore databases list --project="$PROJECT_ID"
```

An empty result is what you want. If it lists a `(default)` database, either point
`firestore_database_id` at that one, or use a genuinely fresh project.

## Step 1 — Enable the two bootstrap APIs

Terraform enables the rest itself, but it cannot enable the APIs it needs in order to enable APIs.

```bash
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com
```

## Step 2 — Create the state bucket

Versioning is the important flag: a corrupted or truncated state file is only recoverable if older
generations still exist.

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update "gs://${BUCKET}" --versioning
```

The bucket name is hardcoded in the `backend "gcs"` block in
[`terraform/versions.tf`](../terraform/versions.tf), because backend blocks cannot read variables.
If you use a different name, either edit that line or pass
`terraform init -backend-config=bucket=…`.

## Step 3 — Create the IAP service agent

IAP reaches Cloud Run as a Google-managed service account, and
[`terraform/iap.tf`](../terraform/iap.tf) grants that account `roles/run.invoker`. The account does
not exist in a new project until something asks for it, and granting a role to a service account
that does not exist fails. So ask for it now:

```bash
gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT_ID"
```

Running this twice is harmless.

## Step 4 — The first apply, from your laptop

There is a chicken-and-egg here worth naming: CI authenticates through a Workload Identity pool and
a service account that **Terraform creates**. So the first apply cannot run in CI. Run it as
yourself:

```bash
gcloud auth application-default login

cd terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # put your own email in admin_principals

terraform init
terraform plan                # read it
terraform apply
```

If `admin_principals` is empty, IAP will lock out everyone including you, because it is deny by
default. Put your address in before applying, not after.

Expect the apply to take a few minutes; enabling APIs and creating the Firestore database are the
slow parts. Cloud Run comes up running Google's public `hello` container — that is deliberate, so
the service and its IAP configuration exist before any application code does.

## Step 5 — Let CI reach the state bucket

The bucket is not managed by Terraform, so its IAM is not either:

```bash
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:$(terraform output -raw terraform_service_account)" \
  --role="roles/storage.objectAdmin"
```

## Step 6 — Wire up GitHub

Read the values out of Terraform:

```bash
terraform output
```

Under **Settings → Secrets and variables → Actions → Variables**, add six repository variables:

| Variable | Value |
| --- | --- |
| `GH_WIF_PROVIDER` | `terraform output -raw workload_identity_provider` |
| `GH_TERRAFORM_SA` | `terraform output -raw terraform_service_account` |
| `GH_DEPLOYER_SA` | `terraform output -raw deployer_service_account` |
| `GH_IMAGE_REPO` | `terraform output -raw admin_image_repository` |
| `GCP_PROJECT_ID` | `hector-golf` |
| `GCP_REGION` | `europe-north1` |

Under **Secrets**, add one:

| Secret | Value |
| --- | --- |
| `TF_ADMIN_PRINCIPALS` | `["user:you@example.com"]` — a JSON array |

That one is a secret rather than a committed `.tfvars` file because this repository is public and
those are real people's email addresses. Terraform reads complex variables from `TF_VAR_*` as JSON,
which is why the quoting looks the way it does.

Finally, under **Settings → Environments**, create an environment called **`infrastructure`** and add
yourself as a required reviewer. That is the approval gate on `terraform apply`.

> Use a new environment, not the existing `production` one. `deploy.yml` and `pr-checks.yml` already
> use `production`, so adding reviewers there would make every site deploy and every PR check wait
> for a human.

## Step 7 — Verify the handover

Open a pull request that changes something trivial under `terraform/` — a comment will do.
`terraform-plan.yml` should authenticate without any key, run, and post the plan as a comment. That
proves Workload Identity Federation, the bucket binding and the variables are all correct.

Merge it and `terraform-apply.yml` should stop and wait for your approval.

## Step 8 — Verify IAP

```bash
terraform output -raw admin_url
```

Open it in a browser. You should get a Google sign-in, then the `hello` page. If you are prompted to
configure an OAuth consent screen, do so once — it is a project-level, one-time setup.

Then confirm the lock actually works: open the same URL in a private window signed in as an account
that is not in `admin_principals`. You should be refused. An admin endpoint you have never verified
rejects a stranger is not an admin endpoint you know anything about.

## Step 9 — The budget alert

Do this on day one. Because billing is enabled on the project, Firestore has no hard spending cap
the way a Spark-plan project does: the free quota is generous, but a runaway write loop in a
half-finished endpoint bills rather than stops.

Terraform can create it, but only with permissions on the *billing account* rather than the project,
which `terraform-ci` deliberately does not have. So run this one locally, as yourself:

```bash
# in terraform.tfvars
enable_budget_alert = true
billing_account     = "01ABCD-234567-89EFGH"   # gcloud billing accounts list
```

```bash
terraform apply
```

Then revert `enable_budget_alert` to `false` before committing, or grant `terraform-ci`
`roles/billing.costsManager` on the billing account if you would rather CI managed it. Creating the
budget by hand in the console is an equally good answer.

## The decisions you cannot take back

| Decision | Why it is permanent |
| --- | --- |
| Firestore `location_id` | Cannot be changed after provisioning. Moving means a new database and a data migration |
| Firestore `type` | Same |
| Firestore `database_edition` | Same. `STANDARD` → `ENTERPRISE` has a documented migration path; the reverse does not |
| Which database got the free tier | The first one created in the project keeps it |

Everything else in `terraform/` can be changed by editing it and re-applying.

## Teardown

`terraform destroy` will **not** delete the Firestore database. That is on purpose:
[`firestore.tf`](../terraform/firestore.tf) sets `deletion_policy = "ABANDON"` and
`delete_protection_state = "DELETE_PROTECTION_ENABLED"`, so a destroy drops it from state and
leaves the data alone. Unlike the JSON files this replaces, there is no `git revert` for a deleted
Firestore database.

Really deleting it takes two deliberate steps: set `delete_protection_state` to
`DELETE_PROTECTION_DISABLED` and apply, then change `deletion_policy` to `"DELETE"` and destroy.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Error 403: Permission denied` on the first apply | Step 1 not run, or `gcloud auth application-default login` is pointed at the wrong account. Check `gcloud config get-value project` |
| `Service account service-…@gcp-sa-iap… does not exist` | Step 3 not run |
| Browser shows "Your client does not have permission to get URL from this server" | The IAP service agent is missing `roles/run.invoker`. Re-apply; if it persists, redeploy the Cloud Run service — IAP caches the backend |
| Sign-in succeeds, then 403 | Your address is not in `admin_principals` / `TF_ADMIN_PRINCIPALS` |
| CI: `Permission denied on resource project` | The `GH_TERRAFORM_SA` variable is wrong, or the WIF binding does not cover this ref. Plan runs on `refs/pull/N/merge`, so the Terraform identity is bound to the repository, not to `main` |
| CI: `Error acquiring the state lock` | A previous run died holding it. `terraform force-unlock <id>` locally, having first checked no apply is actually running |
| `terraform apply` wants to change the Cloud Run image every time | The `ignore_changes` block in [`cloud_run.tf`](../terraform/cloud_run.tf) was removed. Terraform owns the service; the deploy workflow owns the image |
| Images accumulating past the cleanup policy | Something pushed to a repository Terraform does not manage — most likely `gcloud run deploy --source`, which creates `cloud-run-source-deploy` behind your back. Build and push explicitly |

## Once this is done

The infrastructure is in place and empty. The next pieces, in the order they make sense:

1. **Migrate `handicaps` and the player images.** They are the two datasets Git handles worst, and
   neither is edited by a human, so a mistake is cheap.
2. **Build the admin service** under `admin/`, at which point `deploy-admin.yml` starts firing.
3. **Split the data loader** in [`astrosite/src/code/data.ts`](../astrosite/src/code/data.ts) into a
   Firestore implementation and the existing filesystem one, so `astro dev` and `npm test` keep
   running with no emulator, no Java and no credentials.
4. **Decide who wins when CI and a human write the same field.** `player.handicap` is already a
   hand-set override of scraped history, and `update-handicaps.ts` rewrites event `buckets` twice a
   day. Nothing currently marks a value as "set by hand, do not clobber".
