# Retiring the Google Sheets service account key

_Written 2026-09-14. Not executed._

`update-leaderboards.yml` reads two Google Sheets using a downloadable service account key, held in
the `GCP_SERVICE_ACCOUNT_CREDENTIALS` repository secret. This plan replaces it with Workload
Identity Federation, which is how every other workflow in this repository already authenticates to
GCP, and ends with no JSON key existing anywhere.

## Why

Not because the key is exposed — that is a separate, already-handled incident (see `README.md`).
Because it is *downloadable*, and every problem in this area has followed from that:

- a copy ended up inside a Cloud Function source bundle in GCS, with `secretmanager.secretAccessor`
  attached to the account;
- a second copy sits on a laptop at `astrosite/.env.google-credentials.json`;
- a third key, `8fb97428…`, has no identified consumer at all and has not authenticated since
  2025-09-12.

`terraform-ci` and `admin-deployer` have none of these problems, and the reason is structural: they
have no keys to copy. `github_oidc.tf` already says it — *"There is no long-lived credential in this
design to leak or rotate."* This extends that to the last workflow still holding one.

The identity also lives in the wrong project. `update-hector-leaderboard@gen-lang-client-…` is in
the project everything else is migrating out of, and it does not need to be anywhere in particular:
Sheets access is granted by **sharing the spreadsheet with the account's email address**, not by GCP
IAM. Its two project roles — `secretmanager.secretAccessor` and `cloudbuild.builds.builder` — are
leftovers from the deleted `UpdateLeaderboard` function. Its replacement needs **no project roles at
all**.

## Scope

One workflow, one module, two spreadsheets.

| | |
| --- | --- |
| Workflow | `.github/workflows/update-leaderboards.yml` — the only one passing `GOOGLE_CREDENTIALS` |
| Code | `astrosite/src/code/leaderboards/google-sheets.ts`, imported only by `update-leaderboards.ts` |
| Sheets | `HECTOR2024` and `HECTOR2025`. `HECTOR2026` reads from app.hector.golf and is unaffected |

`update-handicaps`, `update-player-biographies` and `update-player-club-memberships` never touch
this credential and are not changed.

Worth knowing before you assume this is low-traffic: the "event finished" filter in
`update-leaderboards.ts` is **commented out**, so both concluded tournaments are re-read on every
run. The Sheets path runs twice a day, not only during a tournament.

## Phase 1 — Terraform

A service account with no project roles, and a WIF binding copied from `admin_deployer_wif` in
[`github_oidc.tf`](../terraform/github_oidc.tf):

```hcl
resource "google_service_account" "leaderboard_reader" {
  project      = var.project_id
  account_id   = "leaderboard-reader"
  display_name = "Reads tournament leaderboards from Google Sheets"
}

# Bound to main, like admin_deployer: this only ever runs from there.
resource "google_service_account_iam_member" "leaderboard_reader_wif" {
  service_account_id = google_service_account.leaderboard_reader.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.ref/refs/heads/main"
}
```

No `google_project_iam_member` for it. If a later change seems to need one, that is a sign something
other than Sheets is being asked of this identity.

Then add a repository **variable** `GH_LEADERBOARD_SA` with the new address, alongside the existing
`GH_DEPLOYER_SA`. A variable, not a secret: it is an email address.

## Phase 2 — Share the spreadsheets

The manual step, and the one that cannot be automated from here. Share both sheets with
`leaderboard-reader@hector-golf.iam.gserviceaccount.com` as **Viewer**. The scrape only reads.

Do this *before* phase 4. A sheet that has not been shared fails with a 403 that reads like an
authentication problem, which sends you looking in the wrong place.

## Phase 3 — The code change

`acquireGoogleCredentials()` in `google-sheets.ts` returns a parsed credentials object, and
`authenticate()` passes it as `new google.auth.GoogleAuth({ credentials, scopes })`. Application
Default Credentials is what `GoogleAuth` uses when `credentials` is omitted, so the change is to
make the field optional rather than to restructure anything:

- keep the `GOOGLE_CREDENTIALS` path exactly as it is, so nothing breaks on the way;
- when the variable is unset, construct `GoogleAuth({ scopes })` with no `credentials` and let ADC
  resolve it;
- the "missing — cannot authenticate" throw goes away, because missing is now the normal case.

The newline-normalising fallback exists only for pasted `.env` values, so it goes when the variable
does, and the parse-failure branch goes with it.

That branch used to log the value it could not parse. An earlier draft of this document called that
"the whole credential in a public repository's log", which was wrong and worth correcting here
rather than quietly: it fired five times on 2026-09-01 and Actions' masking caught it — fourteen
`***`, no key material. It is fixed anyway, in the commit that removed the value and kept the
length, because masking held by accident: what reaches the log is a transformed copy, and the match
only worked because escaping newlines left the PEM body's lines intact as substrings. None of that
applies off Actions, where the same branch printed the credential in full.

## Phase 4 — The workflow

In `update-leaderboards.yml`, drop `GOOGLE_CREDENTIALS` from the step's `env:` and add the auth step
before it:

```yaml
- uses: google-github-actions/auth@v3
  with:
    workload_identity_provider: ${{ vars.GH_WIF_PROVIDER }}
    service_account: ${{ vars.GH_LEADERBOARD_SA }}
```

`permissions: id-token: write` is already declared, so nothing else changes. That action writes an
ADC file and points `GOOGLE_APPLICATION_CREDENTIALS` at it, which is what phase 3 picks up.

## Phase 5 — Verify

Run the workflow by hand and read the log rather than the exit code: it prints which events it found
and which sheet id it is reading. A run that authenticates but cannot see a sheet still exits 0 with
nothing updated.

```bash
gh workflow run update-leaderboards.yml --repo hectorgolf/hector.golf --ref main
gh run list --repo hectorgolf/hector.golf --workflow update-leaderboards.yml --limit 3
```

Expect `Found 2 ongoing Hector events with a live leaderboard` and a sheet id per event.

## Phase 6 — Remove the key

Only after phase 5 is green.

1. Delete the `GCP_SERVICE_ACCOUNT_CREDENTIALS`, `GCP_SERVICE_ACCOUNT_EMAIL` and
   `GCP_SERVICE_ACCOUNT_PRIVATE_KEY` repository secrets. Nothing reads them once phase 4 lands —
   confirm with `grep -rn GCP_SERVICE_ACCOUNT .github/` first.
2. Delete every key on `update-hector-leaderboard@`, then the account itself.
3. Delete `astrosite/.env.google-credentials.json` from the laptop.
4. Remove `GOOGLE_CREDENTIALS` from `astrosite/.env.sample` and replace it with the ADC instructions
   below.

## Running it from your laptop

This is the part that changes for you, and it is the reason to read phase 3 before phase 6.

**Today** `.env` carries `GOOGLE_CREDENTIALS` as one line of JSON — pasted from
`.env.google-credentials.json` — and `npm run update-leaderboards` picks it up through `env-cmd`.

**Afterwards** there is no key to paste. ADC resolves the identity instead, and there are two ways
to set it up.

**As the service account, by impersonation — recommended.**

```bash
gcloud auth application-default login \
  --impersonate-service-account=leaderboard-reader@hector-golf.iam.gserviceaccount.com
```

Your laptop then runs as exactly the identity CI runs as, so a sheet you can read locally is one CI
can read, and a permission problem reproduces instead of appearing only in Actions. It needs
`roles/iam.serviceAccountTokenCreator` on that account for your own Google account, which is one
more Terraform binding:

```hcl
resource "google_service_account_iam_member" "leaderboard_reader_impersonation" {
  service_account_id = google_service_account.leaderboard_reader.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:you@example.com"
}
```

**As yourself.**

```bash
gcloud auth application-default login
```

Simpler, nothing to grant, and it works because you own the spreadsheets. The catch is that it
proves less: you can read those sheets whether or not they have been shared with the service
account, so a local run passing says nothing about whether CI will.

Either way:

- `npm run update-leaderboards` is unchanged. `env-cmd` still loads `.env` for `WISEGOLF_*`,
  `GITHUB_ACCESS_TOKEN` and `HECTOR_APP_API_KEY`; only the `GOOGLE_CREDENTIALS` line goes.
- `.env` must still exist, even empty — `env-cmd` fails without it, which is why `test-unit` runs
  `touch .env` first.
- ADC is still a credential on disk, at `~/.config/gcloud/application_default_credentials.json`.
  The difference is that it is yours, short-lived, refreshable and revocable with
  `gcloud auth application-default revoke` — not a permanent key that can be copied into a zip.
- Expect to re-run the login occasionally. ADC tokens expire; a service account key never did, which
  is the convenience being traded away and the whole point.

## Rollback

Cheap at every phase. Phases 1 and 2 add things nothing uses yet. Phase 3 keeps the
`GOOGLE_CREDENTIALS` path working, so it is a no-op until phase 4. Phase 4 is one revert away, and
the secret still holds a working key until phase 6 — which is the step to leave a week.

## What this does not fix

`8fb97428…` has no identified consumer. It gets deleted in phase 6 along with everything else on
that account, but nobody will have learned what it was for. If something breaks a month later, this
is the first place to look.
