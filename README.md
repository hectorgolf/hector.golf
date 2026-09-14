# TODO

Each item says enough to be acted on without the conversation that produced it.
Things already recorded elsewhere are not repeated here — `docs/current/architecture.md`
§13 is the register of known gaps and drift in the code, and this file is what
somebody decided to do next.

## Cloud Functions

**~~Deploy the `uuid` pin to the running functions.~~** Done, as a side effect. Phase 4 of the
functions migration built all four from `main` on 2026-09-14, so the `hector-golf` copies run
11.1.1. The 8.3.2 copies are the ones in `gen-lang-client-0537211409` that phase 7 deletes.

**~~Tighten the IAM role list in `.github/workflows/deploy-functions.yml`.~~** Done in phase 8. The
header no longer lists roles at all, because the roles are in `terraform/iam.tf` where they are
granted. `storage.objectAdmin` was never granted — the note in `iam.tf` says why it is the wrong
answer, given the Terraform state bucket lives in the same project.

Proven against CI on 2026-09-14, after two rounds. `functions-deployer` needed `serviceAccountUser`
on the identity gen2 builds run as, and something able to set the `allUsers` binding — and in both
cases the error named a far broader grant than the need. The build got its own identity,
`functions-builder`, rather than `actAs` on the `roles/editor` compute account; the `allUsers`
binding moved into `cloud_run.tf` rather than the deployer getting `roles/run.admin`, which reaches
`hector-admin`. Final state: `cloudfunctions.developer` plus `serviceAccountUser` on two named
accounts.

**~~Run `actionlint` over `deploy-functions.yml`.~~** Done 2026-09-14, in phase 8. `actionlint`
reports every workflow in `.github/workflows/` clean, not just this one.

## Security, from the same sweep

**~~Rotate the `update-hector-leaderboard` keys.~~** Done on 2026-09-14, and the account is now
nearly redundant.

`UpdateLeaderboard`'s source bundle contained a service account private key —
`service_account_credentials.json`, committed into the zip sitting in
`gcf-v2-sources-167706335356-europe-north1`. The zip is deleted and it was the last copy (bucket
versioning is on, one version existed; no matching image in `gcf-artifacts`). But deleting a copy is
not revocation, and Policy Analyzer had that key, `583f23a1…`, authenticating through 2026-09-05 —
on an account carrying `roles/secretmanager.secretAccessor`, which reads every secret in the
project.

`583f23a1…` and `8fb97428…` — the latter a year-old key with no identified consumer — are both
deleted. What remains:

| key | consumer | still needed |
| --- | --- | --- |
| `cf542f7b…` | this laptop, `astrosite/.env.google-credentials.json` | only until local runs move to `gcloud auth application-default login` |
| `1d34b5e7…` | nothing | **no** — see below |
| `166650209…` | system-managed, not deletable | n/a |

### `GCP_SERVICE_ACCOUNT_CREDENTIALS` and the key in it can go

`1d34b5e7…` was minted during the rotation to replace `583f23a1…` in the
`GCP_SERVICE_ACCOUNT_CREDENTIALS` secret. That turned out to be unnecessary: the Sheets scrape had
already moved to Workload Identity, so **nothing reads that secret**.
`update-leaderboards.yml` authenticates with `google-github-actions/auth@v3` as
`leaderboard-reader@hector-golf.iam.gserviceaccount.com`, and `GCP_SERVICE_ACCOUNT_CREDENTIALS`
is referenced by no workflow step. Verify with `grep -rn 'secrets\.GCP_SERVICE_ACCOUNT' .github/`,
which returns nothing — note the `secrets.` prefix, because a plain
`grep -rn GCP_SERVICE_ACCOUNT .github/` still finds one line: a comment in `update-leaderboards.yml`
recording which credential the keyless exchange replaced.

So three secrets and one key are disposable. `_EMAIL` and `_PRIVATE_KEY` have not been touched since
2024-09-05 and were never read by anything; `_PRIVATE_KEY` holds the private half of the now-deleted
`583f23a1…`, which makes it inert rather than dangerous, but it reads as live.

```bash
gh secret delete GCP_SERVICE_ACCOUNT_CREDENTIALS --repo hectorgolf/hector.golf
gh secret delete GCP_SERVICE_ACCOUNT_EMAIL --repo hectorgolf/hector.golf
gh secret delete GCP_SERVICE_ACCOUNT_PRIVATE_KEY --repo hectorgolf/hector.golf
gcloud iam service-accounts keys delete 1d34b5e78dfdd12f8f973afbb21166889071f9b3 \
  --iam-account=update-hector-leaderboard@gen-lang-client-0537211409.iam.gserviceaccount.com \
  --project=gen-lang-client-0537211409
```

The lesson worth keeping, since it cost a pointless key: **check the consumer before rotating a
credential, not only the credential.** The rotation steps were written from a reading of
`update-leaderboards.yml` taken earlier the same day, and the workflow had changed underneath them.

### What is left on the account

`cf542f7b…` is the last downloadable Sheets key, and it is a local convenience rather than
infrastructure — `google-sheets.ts` still honours `GOOGLE_CREDENTIALS` when set, so local runs work
either way. The laptop section of
[`docs/plans/sheets-credential-wif.md`](docs/plans/sheets-credential-wif.md) is what replaces it. Once
that happens, `update-hector-leaderboard@` holds nothing anyone uses and the whole account can go —
along with its `roles/secretmanager.secretAccessor` and `roles/cloudbuild.builds.builder`, which it
holds to read one spreadsheet and which are leftovers from the deleted Hello World function.

### For the next time a key needs accounting for

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
