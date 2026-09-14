# Migrating the Cloud Functions into `hector-golf`

The four Cloud Functions in [`backend/backend-functions/`](../../backend/backend-functions/) run in
`gen-lang-client-0537211409`. Everything else — Firestore, the admin service, Artifact Registry, the
scheduler jobs, the Terraform state bucket — is in `hector-golf`. This document is the plan for
closing that split.

Read it end to end before starting. The order of the last three phases matters, and phase 6 is the
only one that is visible to anybody using the site.

## Why

Nobody chose the split. `gen-lang-client-0537211409` is the project Google AI Studio created
alongside the Gemini API key, which is the exact accident [the playbook warns
about](../playbooks/gcp-bootstrapping.md) in the Firestore step. The functions were deployed from a
laptop into whichever project `.env` named, and that was it.

What the split costs, concretely:

- **No CI deploys.** [`deploy-functions.yml`](../../.github/workflows/deploy-functions.yml) ships inert
  because the deploy identity would have to live in a project Terraform does not manage. Activating
  it there means standing up a second Workload Identity pool for a project you would rather delete.
- **Secrets stay on laptops.** `GOOGLE_GEMINI_API_KEY`, `ASTROSITE_API_KEY` and
  `HECTOR_APP_API_KEY` are set by `--set-env-vars` from somebody's `.env`. Secret Manager is in the
  other project, so there is no shared place to put them.
- **Two billing surfaces.** The budget alert in [`budget.tf`](../../terraform/budget.tf) filters on
  `hector-golf` only. Gemini spend is invisible to it.
- **Nothing describes it.** The functions exist in no Terraform, so the only record of what they are
  is the `npm run deploy:*` scripts.

## What has to move, and the thing that does not

The assumption that keeps the functions where they are is that they must run next to the Gemini key.
They do not.

All three Gemini functions pass `process.env.GOOGLE_GEMINI_API_KEY` as a plain string into
`@google/generative-ai`, which calls `generativelanguage.googleapis.com?key=…` over HTTPS. An API
key is a bearer credential, not a project binding — nothing inspects where the caller runs.
`TournamentLeaderboard` does not touch Google APIs at all; it is an HTTP proxy holding
`HECTOR_APP_API_KEY`.

So the compute can move on its own. This plan moves the key as well, because leaving it behind means
keeping the old project alive for one credential, which is most of the cost of the split with none
of the benefit.

There is no "move function between projects" operation in GCP. Every phase below is deploy-new,
verify, cut over, delete-old, and **the URLs change**:

```text
https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/<Name>
https://europe-north1-hector-golf.cloudfunctions.net/<Name>
```

A gen2 function answers on **two** hostnames, and this matters in phase 6 because the repository is
not consistent about which one it uses. The `cloudfunctions.net` form above is a stable alias; the
underlying Cloud Run service also has its own URL, of the shape
`https://tournamentleaderboard-kjr7ijzijq-lz.a.run.app`, with a generated suffix you cannot predict
before deploying. Both currently return 200.

Standardise on the `cloudfunctions.net` alias: it is what the repository already documents
everywhere, and unlike the `run.app` form it is derivable from the project and function name rather
than having to be read back after a deploy. Note that
`gcloud functions describe … --format="value(serviceConfig.uri)"` gives you the *`run.app`* form, so
it is the wrong thing to paste.

The one place holding a `run.app` URL is the `PUBLIC_LEADERBOARD_PROXY_URL` repository variable, set
by hand in 2026-09. That is worth knowing before phase 6 because of what it implies: the value has
no project name in it, so it cannot be reached by substituting one project for another, and it is
not in the tree at all, so no grep will find it. The inventory in phase 6 says what to change where.

## Before you start

Two things to confirm, because both are cheaper to find out now.

**The billing account.** Checked: both projects bill to `billingAccounts/016901-7781DB-45CC39`, so
nothing moves between accounts — only which project the spend is attributed to. The old project runs
about **€0.60/month**, against a first threshold of €1.00 at `budget_amount_eur = 2`, so the
migrated spend does not trip the alert by itself.

**The budget is already raised.** Done on 2026-09-14: the budget filtered to `hector-golf` reads €2,
so the first threshold is €1.00 and the €0.60 of arriving spend clears it. Nothing to do here before
phase 6 — this paragraph exists so that nobody re-checks it.

It was **not** raised with `terraform apply`, and an earlier draft of this plan said it would be.
`budget.tf` is gated on `count = var.enable_budget_alert ? 1 : 0` with the variable `false`, so the
budget is not in Terraform state and an apply changes nothing while appearing to succeed. It is
managed with `gcloud`, per the budget step of
[`../playbooks/gcp-bootstrapping.md`](../playbooks/gcp-bootstrapping.md), and `budget_amount_eur` is
a record of intent rather than the thing that takes effect. If this migration changes the budget
again, change both or neither is true.

Note also a second budget on the account — "€1 Monthly Budget Alert", no project filter, not managed
by this repository at all — which spans both projects and is the likelier source of alert mail that
already reads as noise. It was left alone.

```bash
gcloud billing projects describe gen-lang-client-0537211409 --format="value(billingAccountName)"
gcloud billing projects describe hector-golf --format="value(billingAccountName)"
```

**Nothing else is in the old project.** Checked, and the answer is no: it holds a Firestore
database, `hector-firestore` in `europe-north1`, with backup schedules enabled. It is not there by
accident and it is staying — see "The old project is not deleted" below. Run the playbook's sweep
anyway before phase 7 if time has passed, since the point is to find what nobody remembers putting
there.

Two service accounts are there as well, and neither blocks anything here. `update-hector-leaderboard@`
is being retired by [`sheets-credential-wif.md`](sheets-credential-wif.md), whose phase 6 — deleting
its keys and the account — is the piece of that plan still outstanding. `terraform-deployer` is
dormant and is in the backlog. Both are recorded in [`../../README.md`](../../README.md); this plan
does not touch either, and phase 7 does not wait for them.

## What Terraform owns, and what it does not

Settled before phase 1, because reaching for `google_cloudfunctions2_function` is the obvious move
and it is the wrong one here.

Terraform owns the APIs, the service accounts and IAM, and the Secret Manager *containers*. CI
deploys the functions themselves, wholesale, with `gcloud`. That is the same division as
`deploy-admin.yml`, which ships Cloud Run revisions while Terraform owns the service.

The reason is the one that decides it: **deploying a new version of a function must not require a
`terraform apply`.** Managing the function resource would put the source bundle in Terraform's hands
and have it fight the deploy workflow over every release.

## Phase 1 — Terraform

Five files change — `apis.tf`, `iam.tf`, `github_oidc.tf`, `secrets.tf` and `outputs.tf`. None of
them needs a new role on `terraform-ci`: it already holds `serviceUsageAdmin`,
`serviceAccountAdmin`, `projectIamAdmin` and `secretmanager.admin`, which covers everything below.
That is worth checking rather than assuming when the plan runs, since a missing role shows up as a
mid-apply permission denial.

**[`apis.tf`](../../terraform/apis.tf)** — add to `local.services`:

```hcl
    "cloudfunctions.googleapis.com",     # the functions themselves
    "cloudbuild.googleapis.com",         # gen2 builds the source with a buildpack
    "generativelanguage.googleapis.com", # the Gemini API the three AI functions call
    "apikeys.googleapis.com",            # creating the Gemini key with gcloud in phase 3
```

`run.googleapis.com` and `artifactregistry.googleapis.com` are already enabled, which matters:
gen2 functions *are* Cloud Run services underneath and their images land in Artifact Registry. The
other four are not: checked 2026-09-14, `hector-golf` has none of `cloudfunctions`, `cloudbuild`,
`generativelanguage` or `apikeys` on.

**Do not trim `generativelanguage.googleapis.com` from that list** on the strength of the argument
above that an API key is not a project binding. Both things are true at once: nothing checks where
the *caller* runs, but the API still has to be enabled in the project the *credential* belongs to,
because that is the consumer project the call is attributed to. The new key is minted in
`hector-golf` in phase 2, so `hector-golf` is where the API has to be on.

This is not hypothetical. The Sheets migration next door hit exactly this and needed a follow-up
commit for it — see the comment on `sheets.googleapis.com` in `apis.tf`, which was added to
`local.services` after the fact for the same reason. The failure is a 403 `SERVICE_DISABLED` naming
a project *number*, which reads like a permissions problem rather than a one-line fix.

**[`iam.tf`](../../terraform/iam.tf)** — a runtime identity and a deploy identity, mirroring the
`admin_runtime` / `admin_deployer` split that is already there:

```hcl
resource "google_service_account" "functions_runtime" {
  project      = var.project_id
  account_id   = "hector-functions"
  display_name = "hector.golf Cloud Functions (runtime)"
  description  = "Identity the four functions run as. Reads three secrets; nothing else."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]
}

resource "google_service_account" "functions_deployer" {
  project      = var.project_id
  account_id   = "functions-deployer"
  display_name = "hector.golf functions deploy (GitHub Actions)"
  description  = "Deploys the Cloud Functions. Cannot change infrastructure."
  depends_on   = [google_project_service.enabled["iam.googleapis.com"]]
}

resource "google_project_iam_member" "functions_deployer_deploy" {
  project = var.project_id
  role    = "roles/cloudfunctions.developer"
  member  = google_service_account.functions_deployer.member
}

# Deploying a function that runs as another identity means acting as it. Scoped
# to the one runtime account rather than granted project-wide, as with
# admin_deployer_act_as above.
resource "google_service_account_iam_member" "functions_deployer_act_as" {
  service_account_id = google_service_account.functions_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.functions_deployer.member
}
```

**Do not give the deployer `roles/storage.objectAdmin`.** It is the obvious way to let it upload
source, and it is wrong here: the Terraform state bucket `hector-golf-tfstate` is in this same
project, so a project-wide storage role hands the application deploy identity the infrastructure
state. It is also unnecessary — `gcloud functions deploy` uploads through a signed URL it obtains
from `generateUploadUrl`, which `cloudfunctions.developer` already covers.

Start with the two roles above and add only what a failed deploy actually names. The role list in
[`deploy-functions.yml`](../../.github/workflows/deploy-functions.yml)'s header was written for a
cross-project setup and is broader than this needs; it gets rewritten in phase 8.

**[`github_oidc.tf`](../../terraform/github_oidc.tf)** — bind the new deployer to the *existing* pool,
alongside `admin_deployer_wif` and `leaderboard_reader_wif`. This is the payoff: same project, so
there is one pool, not two.

`leaderboard_reader_wif` is the newest of the three and the closest worked example of the whole
shape this phase repeats — a service account, a ref-scoped `workloadIdentityUser` binding on the
existing pool, an output feeding a `GH_*_SA` repository variable. It went in on 2026-09-14 and is
applied, so copy from it rather than from memory.

**[`secrets.tf`](../../terraform/secrets.tf)** — three more containers, following the rule already
established there: **Terraform creates the container and never the value.**

```hcl
locals {
  function_secrets = {
    "gemini-api-key"     = "GOOGLE_GEMINI_API_KEY"
    "astrosite-api-key"  = "ASTROSITE_API_KEY"
    "hector-app-api-key" = "HECTOR_APP_API_KEY"
  }
}

resource "google_secret_manager_secret" "functions" {
  for_each = local.function_secrets

  project   = var.project_id
  secret_id = each.key

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = { component = "functions" }

  depends_on = [
    google_project_service.enabled["secretmanager.googleapis.com"],
    google_project_iam_member.terraform_ci,
  ]
}

resource "google_secret_manager_secret_iam_member" "functions_runtime_reads" {
  for_each = google_secret_manager_secret.functions

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.functions_runtime.member
}
```

**[`outputs.tf`](../../terraform/outputs.tf)** — the file this plan originally forgot, which is why
the count above says five. Terraform having built these is no use if nothing can read their
addresses back out:

```hcl
output "functions_deployer_service_account" { … }  # the GH_FUNCTIONS_DEPLOYER_SA phase 8 needs
output "functions_runtime_service_account"  { … }  # the --service-account flag in phase 4
output "function_secrets"                   { … }  # secret id => environment variable, for --set-secrets
```

The first is the seam phase 8 turns `deploy-functions.yml` on at, and it pairs with the *existing*
`GH_WIF_PROVIDER` — there is no `GH_FUNCTIONS_WIF_PROVIDER`, which is the whole point of migrating.
The third exists because which key mounts as which environment variable is otherwise knowable only
by reading the `deploy:*` scripts in `package.json`, and phases 3 and 4 both need it.

Update the comment at the top of that file while you are in it: it counts the outputs that feed
GitHub Actions variables, and this adds one.

Apply through the normal PR path: `terraform-plan.yml` comments the plan, `terraform-apply.yml` runs
it on merge. Expect **15 to add, 0 to change, 0 to destroy**. If a local `terraform plan` instead
reports three destroys — `google_iap_settings.admin` and both `cloud_scheduler_job.data_update`
instances — that is not drift: all three are gated on `local.iap_configured`, and you have not
passed `-var iap_oauth_client_id`. CI does.

## Phase 2 — The Gemini key

The new key must belong to `hector-golf`, and it should be restricted to the one API it is for.

```bash
gcloud services api-keys create \
  --project=hector-golf \
  --display-name="Gemini (Cloud Functions)" \
  --api-target=service=generativelanguage.googleapis.com
```

Read the string back with `gcloud services api-keys get-key-string <KEY_ID> --project=hector-golf`.
Google AI Studio's "Create API key in an existing project" does the same thing through a browser;
either is fine, but the restriction is easier to get right on the command line.

Do not reuse the old key. The point of the phase is that the old project becomes deletable, and a
key that lives there keeps it alive.

## Phase 3 — The secret values, by hand

Same shape as the GitHub token in the playbook: the containers exist, the values go in with
`gcloud`, and neither ever enters Terraform state.

```bash
printf %s "$GEMINI_KEY"      | gcloud secrets versions add gemini-api-key     --project=hector-golf --data-file=-
printf %s "$ASTROSITE_KEY"   | gcloud secrets versions add astrosite-api-key  --project=hector-golf --data-file=-
printf %s "$HECTOR_APP_KEY"  | gcloud secrets versions add hector-app-api-key --project=hector-golf --data-file=-
```

`printf %s` rather than `echo`, so no trailing newline ends up in the secret.

`ASTROSITE_API_KEY` and `HECTOR_APP_API_KEY` carry over unchanged — they are hector.golf's own keys
and have nothing to do with the old project.

## Phase 4 — First deploy

By hand, once, because this is the deploy that sets configuration. `--set-secrets` replaces
`--set-env-vars`: the function reads the same variable names, but the values are mounted from
Secret Manager at runtime instead of being baked into the function's configuration.

```bash
cd backend/backend-functions

for fn in ExtractScorecardInformation GeneratePlayerBiography GeneratePlayerAvatar; do
  gcloud functions deploy "$fn" \
    --gen2 --project=hector-golf --region=europe-north1 \
    --runtime=nodejs24 --trigger-http --allow-unauthenticated \
    --entry-point="$fn" --source=. \
    --service-account=hector-functions@hector-golf.iam.gserviceaccount.com \
    --set-secrets=GOOGLE_GEMINI_API_KEY=gemini-api-key:latest,ASTROSITE_API_KEY=astrosite-api-key:latest
done

gcloud functions deploy TournamentLeaderboard \
  --gen2 --project=hector-golf --region=europe-north1 \
  --runtime=nodejs24 --trigger-http --allow-unauthenticated \
  --entry-point=TournamentLeaderboard --source=. \
  --timeout=30s --max-instances=5 \
  --service-account=hector-functions@hector-golf.iam.gserviceaccount.com \
  --set-secrets=HECTOR_APP_API_KEY=hector-app-api-key:latest
```

`GeneratePlayerBiography` and `GeneratePlayerAvatar` also want `--timeout=540s`; the loop above
omits it for brevity, so add it or deploy those two separately. The authority on every flag is the
`deploy:*` scripts in [`package.json`](../../backend/backend-functions/package.json).

No local `npm run clean && npm run gcp-build` is needed before these, even though every `deploy:*`
script does one. `--source=.` uploads `src/` and the buildpack runs the `gcp-build` script — `tsc` —
server-side; `dist/` is gitignored and never uploaded. The local build in those scripts is there to
fail fast on a laptop, not because the deploy needs it.

**This also closes the `uuid` item in [`../../README.md`](../../README.md).** All four functions are
running `uuid` 8.3.2 because nothing deploys them from CI, while `package-lock.json` on `main` pins
11.1.1. These deploys build from `main`, so the new functions get the pin. Which is the argument for
*not* doing the `npm run deploy:all` that item suggests if the migration is going ahead: it would
ship the fix into the project phase 7 deletes.

`--allow-unauthenticated` works here: `hector-golf` is not in an organization — see the note in
[`iap.tf`](../../terraform/iap.tf) — so no domain-restricted-sharing policy blocks an `allUsers`
binding.

**Superseded after phase 8.** The flag is an IAM write — `gcloud` turns it into
`run.services.setIamPolicy` on the underlying Cloud Run service on *every* deploy, even when the
binding is already there — and the CI deploy identity holds no run permissions, so it failed the
first workflow run after all four functions had already updated. The `allUsers` binding is in
[`cloud_run.tf`](../../terraform/cloud_run.tf) now and no deploy passes the flag. It is still correct
for the by-hand deploy this phase describes, if you are running as somebody who can set IAM.

## Phase 5 — Verify, before anything points at them

Both projects' functions are now live and nothing in the site or the workflows has changed yet, so
this phase is free to fail.

```bash
# The proxy: a real tournament id, expecting 200 and a leaderboard payload.
curl -s "https://europe-north1-hector-golf.cloudfunctions.net/TournamentLeaderboard?event=HECTOR2026" | head -c 400

# Its guard clauses: 400 on a missing event, 405 on a POST.
curl -s -o /dev/null -w '%{http_code}\n' "https://europe-north1-hector-golf.cloudfunctions.net/TournamentLeaderboard"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://europe-north1-hector-golf.cloudfunctions.net/TournamentLeaderboard?event=HECTOR2026"

# A Gemini function: 401 without a bearer token proves the key check runs.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerBiography" -d '{}'
```

Two failures are worth telling apart. A `500` from a Gemini function means the secret did not
mount: check with
`gcloud functions describe <Name> --gen2 --region=europe-north1 --project=hector-golf` and confirm
the runtime service account holds `secretAccessor` on that secret. A `403 SERVICE_DISABLED` naming a
project number means the key is fine and `generativelanguage.googleapis.com` is not enabled in
`hector-golf` — phase 1's `apis.tf` change did not land, or has not applied.

Then generate one biography end to end with a real `ASTROSITE_API_KEY`. The Gemini key is the only
thing in this migration that is genuinely new, and a 401 from Google is much easier to diagnose now
than during cutover.

## Phase 6 — Cutover

**This is the ordered part.** The leaderboard proxy URL is baked into the static site at build time,
so the site has to be rebuilt before visitors reach the new function, and the old one has to stay up
until every cached build is gone.

### What actually has to change, and where

Worth reading before touching anything, because the obvious sweep — find every `run.app` URL and
replace it with the alias — does none of the work and breaks a test. **There are no function
`run.app` URLs in the tree.** There are two substitutions with different search patterns, plus one
change no grep can reach.

| where | holds | do |
| --- | --- | --- |
| **`PUBLIC_LEADERBOARD_PROXY_URL`** repository variable | ~~`tournamentleaderboard-…-lz.a.run.app`~~ → the alias | **Done 2026-09-14.** It reads `https://europe-north1-hector-golf.cloudfunctions.net/TournamentLeaderboard`. Recorded because it is the one row no grep can check: the value lives in GitHub settings, not the tree, and it was composed rather than substituted — the old value had no project name in it |
| [`update-player-biographies.ts:174`](../../astrosite/src/workflows/update-player-biographies.ts) | old project, alias form | swap the project name — a code change |
| [`backend/README.md`](../../backend/README.md) :79 :82 :94 :153 | old project, alias form | swap the project name |
| `astrosite/.env.sample:44`, `backend/backend-functions/.env.sample:40`, [`architecture.md`](../current/architecture.md) §10 | `<project>` placeholder in the *URL* | already generic — leave alone |
| `backend/backend-functions/.env.sample:20` | `GCLOUD_PROJECT_ID=gen-lang-client-0537211409` | **Done 2026-09-14.** Not a URL, which is why an earlier version of this table missed it by writing off the whole file as placeholders. It is what the deploy scripts pass to `--project` and what the avatar CLI builds its URL from, so it was a live instruction to deploy into the old project |
| [`generate-player-avatar.ts:35`](../../backend/backend-functions/src/cli/generate-player-avatar.ts) | built from `FUNCTION_REGION` + `GCLOUD_PROJECT_ID` | no code change; the local `.env` is what moves, in step 4 |
| `admin/test/origin.test.ts:40` | `hector-admin-…-lz.a.run.app` | **do not touch.** The admin Cloud Run service, not a function, and the test asserts run.app behaviour — rewriting it inverts the assertion |

So: `gen-lang-client-0537211409` → `hector-golf` in five places that are already in alias form, one
repository variable set to a value that has to be composed rather than edited, and one `run.app` URL
that must survive untouched.

### The ordered steps

1. Set the `PUBLIC_LEADERBOARD_PROXY_URL` repository variable, per the first row above. **Done on
   2026-09-14**, which starts the clock described below.
2. Trigger [`deploy-site.yml`](../../.github/workflows/deploy-site.yml) and wait for Pages to serve
   the rebuilt site. Load a leaderboard page and watch the network tab hit `hector-golf`.

   **Step 1 already commits you to this, whether or not you run it.** `deploy-site.yml` fires on a
   schedule as well as on a push — `cron: "0 8,13 * * *"` — so the next scheduled build picks up
   the new variable and cuts the site over unattended, within twelve hours of the variable changing.
   Pushing or dispatching only decides *when*.

   Two consequences. Setting the variable is the irreversible-ish moment of this phase rather than a
   preparatory step, so do not set it until phase 5 has actually passed against the new function.
   And a push to `main` that touches `astrosite/**` or `.github/workflows/**` triggers the same
   thing incidentally; a docs-only commit does not.
3. Merge the URL change in
   [`update-player-biographies.ts:174`](../../astrosite/src/workflows/update-player-biographies.ts).
   This one is hardcoded, so it is a code change rather than a variable.
4. Update `FUNCTION_REGION` and `GCLOUD_PROJECT_ID` in your local `.env` — that is all the avatar
   CLI and [`generate-avatars.sh`](../../backend/backend-functions/generate-avatars.sh) need, since
   they build the URL from those.
5. Update the documentation — the `backend/README.md` and `.env.sample:20` rows above. **Done
   2026-09-14.** `architecture.md` §10 and the two `<project>` URL placeholders needed nothing.

Leave both sets running. Nothing is saved by hurrying the next phase.

## Phase 7 — Decommission

After a week with no traffic to the old functions — check
`gcloud functions describe … --format="value(serviceConfig.uri)"` against Cloud Run request metrics
in the old project, since gen2 functions report as Cloud Run services:

```bash
for fn in ExtractScorecardInformation GeneratePlayerBiography GeneratePlayerAvatar TournamentLeaderboard; do
  gcloud functions delete "$fn" --gen2 --region=europe-north1 --project=gen-lang-client-0537211409 --quiet
done
```

Delete the old Gemini API key.

### The old project is not deleted

Decided, rather than left open: `gen-lang-client-0537211409` stays, because it holds
`hector-firestore` and the intention is to keep that database available for something else in that
project later.

The reason is the free tier, which is granted **per project** rather than per account. One free
Firestore database per project means the old project's allowance is only usable inside the old
project, and it is spent the moment the database is deleted — there is no way to move it to
`hector-golf`, which is already spending its own on `hector`. Deleting the project would throw the
allowance away to save nothing: an empty project with a scaled-to-zero database costs nothing to
keep.

So phase 7 ends with the four functions and the old Gemini key gone, and the project itself left
standing and empty apart from the database. Anything that assumes the project disappears — the
playbook's stray-project sweep in particular — should expect to keep finding this one, and finding
it is not a loose end.

## Phase 8 — What this repo looks like afterwards

**Done 2026-09-14.** All four bullets landed together, plus two repository variables the plan did
not name — `GH_FUNCTIONS_DEPLOYER_SA` and `GH_FUNCTIONS_RUNTIME_SA`, the second because the workflow
has to state `--service-account` and hardcoding an account into YAML is worse than an output.
`GH_FUNCTIONS_PROJECT_ID` and `GH_FUNCTIONS_WIF_PROVIDER` were *not* created: the workflow uses the
existing `GCP_PROJECT_ID`, `GCP_REGION` and `GH_WIF_PROVIDER`, which is the point.

**The minimal role set is proven.** Every deploy through phase 4 ran as a human owner, so the first
workflow run was the first time `functions-deployer` deployed anything. It took two rounds, and both
are worth reading before granting anything to a deploy identity, because in both the error message
recommended a much broader grant than the situation needed.

**Round one — `iam.serviceaccounts.actAs` on the default compute account.** A gen2 deploy runs a
Cloud Build job and the deployer must act as whatever identity that build uses; unspecified, that is
the project's default compute account, which Google gave `roles/editor`. Doing what the error said
would have let a GitHub Actions run build as project editor. Instead the build got its own identity
— `functions-builder`, holding `roles/cloudbuild.builds.builder` and nothing else — named on every
deploy with `--build-service-account`.

**Round two — `run.services.setIamPolicy`, after all four functions had already deployed.**
`--allow-unauthenticated` is an IAM write rather than a deploy setting, re-asserted on every deploy
even when the binding is already right, so a finished deploy reported a failure. The permission
would have meant `roles/run.admin`, which also reaches `hector-admin`. Instead the `allUsers`
binding moved to [`cloud_run.tf`](../../terraform/cloud_run.tf) and no deploy passes the flag.

So `functions-deployer` still holds `roles/cloudfunctions.developer` and `serviceAccountUser` on two
named accounts — `hector-functions` and `functions-builder` — and nothing else. The rule that got
there: when a deploy fails naming a permission, check what the account it names can already do
before granting anything, and prefer giving the job its own identity over borrowing a privileged
one.

The migration is not finished until these land, because they are what stops the split recurring.

- **[`deploy-functions.yml`](../../.github/workflows/deploy-functions.yml) loses its guard job.** The
  `GH_FUNCTIONS_*` variables and the whole "inert until configured" preamble exist only because of
  the cross-project split. It reuses `GH_WIF_PROVIDER` and a new `GH_FUNCTIONS_DEPLOYER_SA` from the
  same pool, like `deploy-admin.yml`.
- **It can deploy configuration, not just code.** With the keys in Secret Manager, the workflow
  passes `--set-secrets` and `--service-account` on every deploy. The caveat in
  [`backend/README.md`](../../backend/README.md) — that first deploys and key rotations still need the
  npm scripts — goes away. Rotation becomes `gcloud secrets versions add` plus a redeploy, and
  `:latest` means even the redeploy is optional for a new instance.
- **The `deploy:*` scripts in `package.json` drop `--set-env-vars`** and gain `--set-secrets`, so a
  laptop deploy and a CI deploy produce the same function.
- **`architecture.md` §9 and §10** need the new project, the secrets, and the live workflow.

## Rollback

Cheap everywhere, which is the point of the ordering.

| Phase | To undo |
| --- | --- |
| 1–5 | Nothing is pointed at the new functions. Revert the Terraform PR; delete the new functions if you want them gone. |
| 6, step 2 | Put `PUBLIC_LEADERBOARD_PROXY_URL` back and rebuild. The old function is still up. |
| 6, step 3 | Revert the commit. The next scheduled run uses the old URL. |
| 7 | This is the irreversible one. Redeploying into the old project restores the same URLs, but only while that project exists. |

## Cost

Moving the functions moves their spend under the alert in [`budget.tf`](../../terraform/budget.tf),
which is why `budget_amount_eur` went from 1 to 2 alongside this plan. The functions themselves
round to nothing — they scale to zero and the leaderboard proxy is capped at five instances. The
variable is Gemini, and specifically `gemini-3.1-flash-lite-image` behind `GeneratePlayerAvatar`, which
is run by hand rather than on a schedule.

If the alert starts firing on ordinary use, raise the number rather than muting it. A budget alert
that cries wolf teaches you to close the mail without reading it, which is worse than not having one.
