# TODO

Each item says enough to be acted on without the conversation that produced it.
Things already recorded elsewhere are not repeated here — `docs/architecture.md`
§13 is the register of known gaps and drift in the code, and this file is what
somebody decided to do next.

## Cloud Functions

**Deploy the `uuid` pin to the running functions.** [#84](https://github.com/hectorgolf/hector.golf/pull/84)
pinned `uuid` to 11.1.1 in `backend/backend-functions/package-lock.json` and closed the Dependabot
alert, but nothing deploys that package from CI, so all four functions are still running the
vulnerable 8.3.2. One `npm run deploy:all` from `backend/backend-functions`, with `.env` in place,
fixes it.

Not urgent. `cloudevents` calls only `uuid.v4()`, and `v4()` was never the vulnerable path — the
advisory is about missing bounds checks in `v3()`, `v5()` and `v6()`, which nothing in this tree
calls. It is manifest hygiene, not an exposure.

**Tighten the IAM role list in `.github/workflows/deploy-functions.yml`.** Its header names
`cloudfunctions.developer`, `run.developer`, `cloudbuild.builds.editor`, `artifactregistry.writer`,
`storage.objectAdmin` and `iam.serviceAccountUser`. That was written before the narrower set in
`docs/functions-migration.md` phase 1 was worked out, and it is broader than a deploy needs.

`storage.objectAdmin` is the one that matters: granted project-wide it would reach the Terraform
state bucket. `gcloud functions deploy` uploads through a signed URL from `generateUploadUrl`, which
`cloudfunctions.developer` already covers, so it is unnecessary as well as risky. The migration plan
rewrites this header in its phase 8; if the migration is deferred, fix the header anyway.

**Run `actionlint` over `deploy-functions.yml`.** It was written on a machine without actionlint
installed, so it has been checked by hand — the YAML parses to the intended structure, the guard's
bash was exercised under `bash -e` in all three variable states, and the rendered `gcloud` command
is syntax-checked with and without the matrix's `extra_flags` — but never linted.

## Security, from the same sweep

**Rotate the `update-hector-leaderboard` keys.** `UpdateLeaderboard`'s source bundle contained a
service account private key — `service_account_credentials.json`, committed into the zip that was
sitting in `gcf-v2-sources-167706335356-europe-north1`. The zip is deleted and it was the last copy
(bucket versioning is on, one version existed; no matching image in `gcf-artifacts`), so nothing new
is exposed. **Deleting a copy is not revocation**, though: the key is still valid.

It is `583f23a1…`, and it is not dormant — Policy Analyzer reports it authenticating through
2026-09-05, the end of its observation window. The account carries `roles/secretmanager.secretAccessor`,
so that key reads every secret in the project.

What blocks the rotation is that **two** of its keys are live: `583f23a1…` and `cf542f7b…`
(2026-09-01). So two things use this account and only one of them is CI —
`update-leaderboards.yml:64` passes `GCP_SERVICE_ACCOUNT_CREDENTIALS` as `GOOGLE_CREDENTIALS` for
Sheets access. GitHub secrets cannot be read back, so identifying which is which means either a
throwaway workflow that prints only `private_key_id`, or the local copy of the JSON. Find the second
consumer first: rotating blind fixes CI and silently breaks whatever else is using the other key.

Enable it with:

```bash
gcloud services enable policyanalyzer.googleapis.com --project=hector-golf
gcloud policy-intelligence query-activity --activity-type=serviceAccountKeyLastAuthentication \
  --project=gen-lang-client-0537211409 --format=json
```

Note that report lists keys that no longer exist — it records what has authenticated, not what is
there — so check anything it names against `gcloud iam service-accounts keys list`.

**Decide what to do with `terraform-deployer`.** A dormant identity in the old project, last
authenticated 2025-04-06, holding `iam.serviceAccountAdmin`, `iam.serviceAccountUser` and
`storage.admin` — enough to impersonate any service account in the project, including the one above.
Its one never-used key is deleted; one user-managed key remains. The roles are normal for a Terraform
identity and the dormancy is the problem, so the suggested order is disable, wait a week, then delete.
Not urgent, and nothing about it is reachable without existing project access.

## Decisions before the migration runs

All settled. `docs/functions-migration.md` is no longer blocked on a decision, and phases 1 and 8
stand as written.

**~~Migrate first, or activate `deploy-functions.yml` where the functions are now?~~** Migrate
first. Standing up a second Workload Identity pool in the old project is throwaway work, and the
workflow stays inert until phase 8 turns it on in `hector-golf`.

**~~Should Terraform own the functions themselves?~~** No. Deploying a new version of a function
must not require a `terraform apply`. That is the split the plan already assumes — Terraform owns
the APIs, identities and secret containers, CI deploys the functions wholesale with `gcloud`, the
same division as `deploy-admin.yml` — so nothing in phases 1 or 8 changes. Recorded here because
`google_cloudfunctions2_function` is the obvious thing to reach for and this says why not to.

**~~Check €2/month against real Gemini spend.~~** `gen-lang-client-0537211409` runs about
**€0.60/month**. Against `budget_amount_eur = 2` the first threshold is €1.00, so the migrated
spend does not fire it on its own and the raise from 1 to 2 was the right call.

One thing that came out of checking, and it is an action rather than a decision: **the €2 is not
live.** The budget on the billing account still reads €1, so `budget_amount_eur = 2` is committed
but unapplied. At €1 the first threshold is €0.50 and €0.60 of migrated spend crosses it on arrival,
so the `terraform apply` has to land before or with the migration rather than after it.

There is also a **second budget nobody's Terraform owns**: "€1 Monthly Budget Alert", with no
project filter, so it spans the whole billing account rather than `hector-golf`. It is the likelier
source of any alert mail that already looks like noise, and it is worth either adopting or deleting
before judging the managed one.

**~~Find out what else lives in `gen-lang-client-0537211409`.~~** Answered, and acted on. It holds
`hector-firestore`, deliberately, and the project is therefore not deleted — `docs/functions-migration.md`
phase 7 now says so rather than leaving it open.

The three functions phase 7 did not name are gone. `greeting-function` and `task-processor-function`
in `europe-west3` were tutorial leftovers — deployed eight seconds apart, running as the default App
Engine account, no log entries in 180 days. `UpdateLeaderboard` turned out to be the Cloud Functions
Hello World scaffold under a name someone meant to implement: its whole body was
``res.send(`Hello ${name}`)``, deployed 2024-09-05 and never touched again. Its Cloud Run service and
source object went with it. The project now holds exactly the four functions phase 7 names.

**~~Confirm whether both projects bill to the same account.~~** Answered: both are on
`billingAccounts/016901-7781DB-45CC39`, so the migration moves no money between accounts. What it
moves is which project the spend is attributed to, which is what the budget filter sees.

## Documentation

**The CI/CD table in `docs/architecture.md` §9 is missing rows.** `admin-checks.yml`,
`backend-checks.yml`, `export-admin-data.yml` and `refresh-admin-mirror.yml` are not in it. Noticed
while adding `deploy-functions.yml` to that table; left alone at the time to keep the diff narrow.
