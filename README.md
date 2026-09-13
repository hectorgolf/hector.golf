# TODO

Each item says enough to be acted on without the conversation that produced it.
Things already recorded elsewhere are not repeated here — `docs/current/architecture.md`
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
`docs/plans/functions-migration.md` phase 1 was worked out, and it is broader than a deploy needs.

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

Every key on the account is now accounted for, so the rotation is not blocked on anything:

| key | consumer | exposed in the zip |
| --- | --- | --- |
| `583f23a1…` | GitHub Actions, via `GCP_SERVICE_ACCOUNT_CREDENTIALS` | **yes** |
| `cf542f7b…` | this laptop, `astrosite/.env.google-credentials.json` | no |
| `8fb97428…` | none found, last used 2025-09-12 | no |

Two things settle the first row without reading the secret, which cannot be read back. `gh secret
list --json name,updatedAt` reports `GCP_SERVICE_ACCOUNT_CREDENTIALS` as last updated **2024-09-05**
and never since, and `583f23a1…` was created 2024-09-04 — a secret nobody has touched cannot hold a
key minted eighteen months later. And `cf542f7b…` is on disk locally, in a file written four and a
half hours after that key was created, holding the same `private_key_id`; `docs/current/architecture.md` §13
already records that file as real credentials in the working tree. Nothing reads it by name —
`google-sheets.ts` takes `GOOGLE_CREDENTIALS` from the environment — so it is a holding copy pasted
into `.env` for a manual run, which matches a last authentication of 2026-09-01 with no cron behind
it.

So the rotation is narrow: **only `583f23a1…` was ever in the zip.** `cf542f7b…` needs no action.

Before rotating, read [`docs/plans/sheets-credential-wif.md`](docs/plans/sheets-credential-wif.md), which
retires the key rather than replacing it: the workflow already declares `id-token: write` and
`GH_WIF_PROVIDER` already exists, so this is the last workflow still holding a downloadable
credential. Rotating now and moving to WIF later is a reasonable order — it closes the exposure
today — but it mints one more key into the project everything else is migrating out of.

1. Mint a new key and update `GCP_SERVICE_ACCOUNT_CREDENTIALS`.
2. Run `update-leaderboards.yml` by hand and confirm it is green — that proves the new key works
   before anything is destroyed.
3. Delete `583f23a1…`, and `8fb97428…` with it: a year-old key with no identified consumer is the
   thing you do not want left lying around.

While in there, ask whether the account needs `roles/secretmanager.secretAccessor` at all. It reads
one Google Sheet. The role gives it every secret in the project, and it is there because of the
Hello World function that has now been deleted.

The evidence above came from Policy Analyzer:

```bash
gcloud services enable policyanalyzer.googleapis.com --project=hector-golf
gcloud policy-intelligence query-activity --activity-type=serviceAccountKeyLastAuthentication \
  --project=gen-lang-client-0537211409 --format=json
```

Two traps in it. It lists keys that no longer exist — it records what has authenticated, not what is
there — so check anything it names against `gcloud iam service-accounts keys list`. And audit logs
cannot stand in for it here: `protoPayload.authenticationInfo.serviceAccountKeyName` is never
populated in this project, because Data Access logging is off, so a query on that field comes back
empty whether or not the key is in use.

**Decide what to do with `terraform-deployer`.** A dormant identity in the old project, last
authenticated 2025-04-06, holding `iam.serviceAccountAdmin`, `iam.serviceAccountUser` and
`storage.admin` — enough to impersonate any service account in the project, including the one above.
Its one never-used key is deleted; one user-managed key remains. The roles are normal for a Terraform
identity and the dormancy is the problem, so the suggested order is disable, wait a week, then delete.
Not urgent, and nothing about it is reachable without existing project access.

## Decisions before the migration runs

All settled. `docs/plans/functions-migration.md` is no longer blocked on a decision, and phases 1 and 8
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

**~~The €2 is not live.~~** Done, on 2026-09-14: the budget filtered to `hector-golf` now reads €2,
so the first threshold is €1.00 rather than €0.50 and the €0.60 of arriving spend clears it.

Worth recording *how*, because an earlier version of this entry said a `terraform apply` was what
was missing and that was wrong. `budget.tf` is gated on `count = var.enable_budget_alert ? 1 : 0`
and the variable is `false`, so the budget is not in Terraform state and an apply would have changed
nothing while looking like it had. The repository is deliberate about this — turning the variable on
locally is the *worst* of the three states, because CI reads the default `false` and plans to
destroy a budget it has no billing permission to refresh. The sanctioned mechanism is `gcloud`, as
in the bootstrapping playbook's budget step, and that is what was used:

```bash
gcloud billing budgets update <budget-id> --billing-account="$BILLING" \
  --display-name="hector.golf - alert above EUR 2/month" --budget-amount=2EUR
```

`budget_amount_eur = 2` in `variables.tf` is therefore documentation of intent rather than the thing
that takes effect. Anyone changing the budget changes both, or neither is true.

There is also a **second budget nobody's Terraform owns**: "€1 Monthly Budget Alert", with no
project filter, so it spans the whole billing account rather than `hector-golf`. It is the likelier
source of any alert mail that already looks like noise, and it is worth either adopting or deleting
before judging the managed one.

**~~Find out what else lives in `gen-lang-client-0537211409`.~~** Answered, and acted on. It holds
`hector-firestore`, deliberately, and the project is therefore not deleted — `docs/plans/functions-migration.md`
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

## Buried in a `current/` document

Both of these were tracked nowhere but inside a document that otherwise describes how things are,
which is what the `docs/plans` and `docs/current` split was made to surface. See
[`docs/README.md`](docs/README.md).

**`event.bucketsLocked` and `player.biographyLocked` do not exist.**
[`docs/current/data-ownership.md`](docs/current/data-ownership.md) specifies both — separate empty
guard fields, so that no existing value is silently reinterpreted as a deliberate lock — and says
plainly that they are not implemented. Nothing in any schema, page or script has them.

`bucketsLocked` is now the narrower of the two: `bucketsAreOpen()` already stops CI at 08:00 on the
first morning, so the field is only about locking buckets *earlier* than that.

**Two of the four next steps the GCP setup was aiming at are still open.** They used to live at the
end of the setup document, which is why nobody saw them; splitting that document moved them here and
dropped the section. The admin service was built and the ownership question was settled; these were
not:

- *Migrate `handicaps` and the player images into Firestore.* Named as the place to start because
  Git handles them worst and neither is edited by a human, so a mistake is cheap. Still 1397 entries
  in `handicaps.json` and 40 image files on disk.
- *Split the data loader.* `astrosite/src/code/data.ts` is still filesystem-only — zero Firestore
  references — so the Firestore implementation the playbook envisages, with `astro dev` and
  `npm test` still running against files, has not been started.

## Documentation

**The CI/CD table in `docs/current/architecture.md` §9 is missing rows.** `admin-checks.yml`,
`backend-checks.yml`, `export-admin-data.yml` and `refresh-admin-mirror.yml` are not in it. Noticed
while adding `deploy-functions.yml` to that table; left alone at the time to keep the diff narrow.
