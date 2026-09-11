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

### Point Application Default Credentials at the right account

Do this before anything else, because `gcloud` keeps **two separate credential stores** and it is
easy to have them on different accounts without noticing:

| Store | Set by | Used by |
| --- | --- | --- |
| CLI credentials | `gcloud auth login` | every `gcloud` command |
| Application Default Credentials (ADC) | `gcloud auth application-default login` | client libraries, and **Terraform** |

Terraform reads only the second one. If you have ever used `gcloud` for work, ADC is probably still
pointed at that account, and `terraform apply` will try to build Hector's infrastructure as your
work identity.

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT_ID"
```

Check which identity you actually ended up with:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  https://www.googleapis.com/oauth2/v3/userinfo
```

> **ADC is a single global file.** Logging in here replaces whatever was there before, so anything
> local that authenticates to another project through ADC will stop working until you log back in
> for it. To keep two setups side by side, relocate the whole gcloud configuration directory —
> `CLOUDSDK_CONFIG` moves the ADC file with it:
>
> ```bash
> export CLOUDSDK_CONFIG="$HOME/.config/gcloud-hector"
> gcloud auth login your.personal@example.com
> gcloud auth application-default login
> gcloud config set project hector-golf
> gcloud auth application-default set-quota-project hector-golf
> ```
>
> Then export that variable in every shell where you work on Hector.

While you are here, check `gcloud config list` for a `[run] region` left over from another project.
CI is unaffected — [`deploy-admin.yml`](../.github/workflows/deploy-admin.yml) passes `--region`
explicitly — but a manual `gcloud run deploy` would deploy to the wrong region.

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

If you have already created a database by hand and this comes back empty, it went somewhere else.
The console remembers whichever project you last had selected, and an auto-generated
`gen-lang-client-*` project — the one Google AI Studio creates alongside a Gemini API key — is an
easy one to land in without noticing. Look across everything you can see:

```bash
for p in $(gcloud projects list --format="value(projectId)"); do
  echo "== $p"
  gcloud firestore databases list --project="$p" \
    --format="value(name,locationId,databaseEdition)" 2>/dev/null
done
```

Create the real one here anyway rather than adopting the stray. The free tier is per project, so a
database created in the wrong project has spent *that* project's allowance and cannot lend it to
this one — there is nothing to rescue by adopting it.

Whether to then delete the stray is a separate question, and the answer is usually no. An empty
Firestore database costs essentially nothing to keep, and that project now has a free-tier database
sitting ready should it ever want one. Deleting it may or may not return the allowance for a future
database there, and there is no reason to find out. Delete it only if you actively want the project
tidy — turning off delete protection first if it is on:

```bash
gcloud firestore databases delete --database=DATABASE_ID --project=WRONG_PROJECT
```

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
yourself, using the ADC credentials from "Before you start":

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # admin_principals, and keep admin_image for now

terraform init
terraform plan                # read it
terraform apply
```

Two things in that file matter for this run.

**`admin_principals`.** If it is empty, IAP locks out everyone including you, because it is deny by
default. Put your address in before applying, not after.

**`admin_image`.** Leave the placeholder line in for this first apply only. Cloud Run cannot create
a service whose image will not pull, and nothing has been pushed to Artifact Registry yet, so the
config falls back to a public container for exactly one run:

```hcl
admin_image = "us-docker.pkg.dev/cloudrun/container/hello"
```

Normally that variable is unset and [`cloud_run.tf`](../terraform/cloud_run.tf) composes the image
name itself, from the Artifact Registry resource:

```hcl
image = coalesce(var.admin_image, "${local.admin_image_repo}:latest")
```

So the committed configuration always reads as "the admin image", and the placeholder lives in your
local, gitignored `terraform.tfvars` rather than in the repository. Step 11 removes it.

Expect the apply to take a few minutes; enabling APIs and creating the Firestore database are the
slow parts. Cloud Run comes up running the `hello` container — deliberately, so the service and its
IAP configuration exist and can be verified before any application code does. It is not exposed
while it sits there: IAP is in front of it.

## Step 5 — Give IAP an OAuth client

The apply in step 4 turned IAP on, but IAP has nothing to authenticate *with* yet, so the service
answers:

> Empty Google Account OAuth client ID(s)/secret(s).

That is not a misconfiguration to hunt down. Google's rule is that "Google-managed OAuth clients can
only be used to manage access for internal users that are within an organization", and two separate
things here put us outside that:

- `hector-golf` is a standalone project, not in a Google Cloud organization, and
- every Hector admin signs in with a personal Google account, which is an **external** user.

The second is why moving the project into an organization would not help — external users need a
custom client either way. A custom OAuth client is the correct configuration here, not a workaround.

Neither part can be done from Terraform: the IAP OAuth Admin APIs were shut down in March 2026, and
`google_iap_brand` requires an organization. Both are console steps, once per project.

### 1. Configure the consent screen

<https://console.cloud.google.com/auth/branding?project=hector-golf>

This page was called "OAuth consent screen" before it moved under **Google Auth Platform**, which is
why older instructions point at `APIs & Services`. Click **Get started**:

| Field | Value |
| --- | --- |
| App name | What the sign-in screen shows, e.g. "Hector Admin" |
| User support email | Your address |
| Audience | **External** — Internal is not offered without an organization |
| Contact information | Your address |

On the **Audience** tab, add each admin as a test user. IAP only asks for basic scopes, so you can
also publish to Production without going through Google's verification review, which removes the
"Google hasn't verified this app" interstitial.

### 2. Create the OAuth client

<https://console.cloud.google.com/security/iap?project=hector-golf>

Find `hector-admin` in the Applications list → **More options** → **Settings** → **Custom OAuth** →
**Auto Generate Credentials**. That creates the client *and* sets its redirect URI in one go. Doing
it by hand instead means adding this to the client yourself:

```
https://iap.googleapis.com/v1/oauth/clientIds/YOUR_CLIENT_ID:handleRedirect
```

Click **Download credentials** for the id and secret, then **Save**. The `hello` page should now
load behind a Google sign-in.

### 3. Record it in Terraform

Put both values in your gitignored `terraform.tfvars`:

```hcl
iap_oauth_client_id     = "1234-abcd.apps.googleusercontent.com"
iap_oauth_client_secret = "GOCSPX-..."
```

Then `terraform apply`. Expect **`1 to add`** and nothing else: `google_iap_settings` adopts the
configuration you just made by hand, so a project rebuilt from this directory comes back working
rather than showing the error above. If the plan proposes anything about the Cloud Run service
itself, stop and read it.

Setting only one of the two is rejected at plan time rather than half-applied — IAP needs the pair.
Setting neither leaves the resource out of the plan entirely, which is what let step 4 run before
this step existed.

> The secret is stored in Terraform state as plain text; the provider documents this. The state
> bucket is private, uniform-access and public-access-prevented, which makes that acceptable rather
> than harmless. Rotate the client if the bucket is ever exposed.

## Step 6 — Let CI reach the state bucket

The bucket is not managed by Terraform, so its IAM is not either:

```bash
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:$(terraform output -raw terraform_service_account)" \
  --role="roles/storage.objectAdmin"
```

## Step 7 — Wire up GitHub

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
| `TF_IAP_OAUTH_CLIENT_ID` | The client id from step 5 |
| `TF_IAP_OAUTH_CLIENT_SECRET` | The client secret from step 5 |

That one is a secret rather than a committed `.tfvars` file because this repository is public and
those are real people's email addresses. Terraform reads complex variables from `TF_VAR_*` as JSON,
which is why the quoting looks the way it does.

Both Terraform workflows refuse to start until `GH_WIF_PROVIDER`, `GH_TERRAFORM_SA` and
`TF_ADMIN_PRINCIPALS` are all present, and say which is missing. The first two are just
"CI cannot reach GCP yet". `TF_ADMIN_PRINCIPALS` is the dangerous one: without it Terraform reads
`admin_principals` as an empty list, and an empty list is not a no-op — it is an instruction to
revoke every IAP binding that exists. That would look like an ordinary plan and lock everyone out of
a service that was working. The variable also rejects an empty list on its own, so the failure is
loud from either direction.

Finally, under **Settings → Environments**, create an environment called **`infrastructure`** and add
yourself as a required reviewer. That is the approval gate on `terraform apply`.

> Use a new environment, not the existing `production` one. `deploy.yml` and `pr-checks.yml` already
> use `production`, so adding reviewers there would make every site deploy and every PR check wait
> for a human.

## Step 8 — Verify the handover

Open a pull request that changes something trivial under `terraform/` — a comment will do.
`terraform-plan.yml` should authenticate without any key, run, and post the plan as a comment. That
proves Workload Identity Federation, the bucket binding and the variables are all correct.

Merge it and `terraform-apply.yml` should stop and wait for your approval.

## Step 9 — Verify IAP

```bash
terraform output -raw admin_url
```

Open it in a browser. You should get a Google sign-in, then the `hello` page. If you instead see
"Empty Google Account OAuth client ID(s)/secret(s)", step 5 is incomplete.

Then confirm the lock actually works: open the same URL in a private window signed in as an account
that is not in `admin_principals`. You should be refused. An admin endpoint you have never verified
rejects a stranger is not an admin endpoint you know anything about.

## Step 10 — The budget alert

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

## Step 11 — After the first real deploy, drop the placeholder

Once [`deploy-admin.yml`](../.github/workflows/deploy-admin.yml) has run once, there is a real image
in Artifact Registry and the placeholder has done its job. Delete these lines from
`terraform.tfvars`:

```hcl
admin_image = "us-docker.pkg.dev/cloudrun/container/hello"
```

Nothing happens when you next apply, and that is the point. `cloud_run.tf` ignores changes to the
running image — the deploy workflow owns it, Terraform owns the service around it — so removing the
override changes no live resource. What it changes is what the configuration *says*: from a
placeholder nobody should read as real, to `<repo>/admin:latest`, which is true.

That fallback only gets used if Terraform ever has to name an image itself, which means a service
recreated from scratch. It resolves because the deploy workflow pushes `latest` alongside the SHA
tag it actually deploys.

To see what is really running, ask the service rather than the configuration:

```bash
gcloud run services describe hector-admin --region="$REGION" \
  --format="value(spec.template.spec.containers[0].image)"
```

## Adopting something that already exists

If a resource is already there — because it got clicked into being before anyone read this, or
because you are adopting the Cloud Functions under `backend/` later — do not run `terraform import`
from a laptop. Use an [`import` block](https://developer.hashicorp.com/terraform/language/import),
so the adoption is reviewed in a pull request and `terraform plan` says whether the committed config
matches reality *before* anything is applied.

```hcl
import {
  to = google_firestore_database.hector
  id = "projects/hector-golf/databases/hector"
}
```

`google_firestore_database` accepts `projects/{project}/databases/{name}`, `{project}/{name}` or
just `{name}`. Other resource types have their own accepted formats, listed under "Import" in the
provider documentation for each.

Then run `terraform plan` and read the summary line. What you want is **`1 to import, 0 to add,
0 to change`**:

| Plan says | Meaning |
| --- | --- |
| `to change` | The config and the real resource disagree on a mutable field. Decide which one is wrong and fix it — for a database created by hand, `delete_protection_state` and `point_in_time_recovery_enablement` are the usual two |
| `forces replacement` | The real resource cannot be adopted as configured. Terraform would destroy and recreate it. For Firestore this means `location_id`, `type` or `database_edition`, none of which can be changed — so either match the config to reality, or recreate the resource deliberately |
| `to add` alongside the import | The `id` does not point at anything. Check the project and the resource name |

**Delete the `import` block once the apply has succeeded.** It is a one-shot instruction rather
than a permanent part of the configuration, and leaving it in means every future plan re-checks an
import that already happened.

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
| `WARNING: Your active project does not match the quota project in your local Application Default Credentials file` | Expected on a fresh project, and benign in itself — but it means ADC has a different project, usually because ADC belongs to a different account. Fix it with the ADC step in "Before you start" rather than ignoring it |
| `set-quota-project`: `the account in ADC does not have the "serviceusage.services.use" permission on this project` | ADC is authenticated as an account with no access to this project. `gcloud auth list` shows the CLI account; the two are independent. Re-run `gcloud auth application-default login` as the account that owns the project |
| `Error 403: Permission denied` on the first apply | Step 1 not run, or ADC is pointed at the wrong account — the CLI account being right does not mean ADC is. Check with the `userinfo` command in "Before you start" |
| `Service account service-…@gcp-sa-iap… does not exist` | Step 3 not run |
| A database you created by hand is not listed in this project | The console was pointed at a different project. Use the cross-project loop in "Check the free-tier database first" to find it |
| Browser shows "Empty Google Account OAuth client ID(s)/secret(s)" | IAP is on but has no OAuth client. This project is outside an organization and its users are external, so Google's managed client cannot be used — do step 5 |
| Browser shows "Your client does not have permission to get URL from this server" | The IAP service agent is missing `roles/run.invoker`. Re-apply; if it persists, redeploy the Cloud Run service — IAP caches the backend |
| Sign-in succeeds, then 403 | Your address is not in `admin_principals` / `TF_ADMIN_PRINCIPALS` |
| CI: `the GitHub Action workflow must specify exactly one of "workload_identity_provider" or "credentials_json"` | `GH_WIF_PROVIDER` is unset, so it expands to an empty string. The action's message about forks and Dependabot is a red herring — do step 7 |
| CI: `Permission denied on resource project` | The `GH_TERRAFORM_SA` variable is wrong, or the WIF binding does not cover this ref. Plan runs on `refs/pull/N/merge`, so the Terraform identity is bound to the repository, not to `main` |
| CI: `Error acquiring the state lock` | A previous run died holding it. `terraform force-unlock <id>` locally, having first checked no apply is actually running |
| First apply fails with the revision never becoming ready, or an image pull error | `admin_image` is unset on a project with nothing in Artifact Registry yet. Put the placeholder line back for that one run — see step 4 |
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
