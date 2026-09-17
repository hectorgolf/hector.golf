# Retiring the Google Sheets service account key

*Written and executed 2026-09-14, all six phases (#99, #101, #100). Phase 6 was scheduled for
2026-09-21 and brought forward once phase 5 verified green. **Done. Kept only for the two dated
items under "Still live" — after 2026-10-14 this file records nothing that is not recorded closer to
the code, and can go.***

## Why it was done

`update-leaderboards.yml` read two Google Sheets using a *downloadable* service account key, held in
the `GCP_SERVICE_ACCOUNT_CREDENTIALS` repository secret — the last workflow in the repository still
holding one. Not because that key was exposed, but because being downloadable is what every problem
in the area had followed from: a copy inside a Cloud Function source bundle in GCS with
`secretmanager.secretAccessor` attached to the account, a second copy on a laptop, and a third key
that had not authenticated since 2025-09-12 and had no identified consumer at all. `terraform-ci`
and `admin-deployer` had none of those problems for a structural reason — they have no keys to copy.

The identity was also in the wrong project, and did not need to be in any particular one: Sheets
access is granted by sharing the spreadsheet with the account's email address, not by GCP IAM. Its
replacement, `leaderboard-reader@hector-golf`, holds **no project roles at all**.

## What it changed

| | |
| --- | --- |
| `terraform/github_oidc.tf`, `iam.tf` | `leaderboard-reader`, and a `workloadIdentityUser` binding scoped to `refs/heads/main` on the existing pool |
| `terraform/apis.tf` | `sheets.googleapis.com`, enabled in `hector-golf` — the one thing that actually blocked the migration |
| `astrosite/src/code/leaderboards/google-sheets.ts` | `credentials` became optional, so `GoogleAuth` falls back to ADC; the 403 handler asks the auth client which identity it acted as, rather than reading a parsed credential that no longer exists |
| `.github/workflows/update-leaderboards.yml` | A `google-github-actions/auth@v3` step using `GH_WIF_PROVIDER` and `GH_LEADERBOARD_SA`, replacing `GOOGLE_CREDENTIALS` in the step's `env:` |
| Deleted | The three `GCP_SERVICE_ACCOUNT_*` repository secrets, every key on `update-hector-leaderboard@`, that account, its two leftover project roles, and the laptop copy at `astrosite/.env.google-credentials.json` |

`GOOGLE_CREDENTIALS` still wins where one is set, so the old path is intact for anyone who needs it;
there is simply no key left to put in it.

## Still live

Two dated items, and the only reason this file has not been deleted.

**The deleted account is undeletable until 2026-10-14.** `update-hector-leaderboard@`, uniqueId
`117677587522329827385` — which is what an undelete would need. Deleting it left its two roles in the
project IAM policy as `deleted:serviceAccount:…?uid=…` tombstones; those were removed too, but they
would come back with an undelete.

**`8fb97428…` had no identified consumer.** It was deleted along with everything else on that
account and nobody ever learned what it was for. If something breaks without explanation before
mid-October, this is the first place to look.

## Where the detail went

The phase-by-phase reasoning is not here because it is in the code it governs, which is where it
gets read:

| what | now lives in |
| --- | --- |
| Why the identity holds no project roles, and the ref-scoped WIF binding | [`terraform/github_oidc.tf`](../../terraform/github_oidc.tf) |
| Why `sheets.googleapis.com` had to be enabled here — a service account's *consumer project* is the project it lives in, and the failure is a `SERVICE_DISABLED` 403 naming a project number, which looks exactly like the unshared-sheet 403 | [`terraform/apis.tf`](../../terraform/apis.tf) |
| Why the 403 handler asks the auth client for the acting identity, lazily and without being allowed to fail | [`google-sheets.ts`](../../astrosite/src/code/leaderboards/google-sheets.ts) |
| The 2026-09-01 logging incident: what reached the log was a transformed copy, Actions' masking held by accident, and nothing outside Actions masks anything | [`google-sheets.ts`](../../astrosite/src/code/leaderboards/google-sheets.ts) |
| How the running system authenticates, and the `GH_LEADERBOARD_SA` variable | [`current/architecture.md`](../current/architecture.md) |
| Running the scrape locally as this identity | [`playbooks/local-gcp-identities.md`](../playbooks/local-gcp-identities.md) |
| `TF_LEADERBOARD_IMPERSONATORS`, and why it is a variable rather than a secret | [`playbooks/gcp-bootstrapping.md`](../playbooks/gcp-bootstrapping.md) |

One thing this plan noticed that is still true and is written down nowhere else: the "event
finished" filter in [`update-leaderboards.ts`](../../astrosite/src/workflows/update-leaderboards.ts)
is commented out, so both concluded tournaments are re-read on **every** tick rather than only
during a tournament. It is a property of the scrape rather than of this migration, and it wants a
home in `current/` before this file goes.

Two code comments cite this file for background — [`terraform/iam.tf`](../../terraform/iam.tf) and
[`update-leaderboards.yml`](../../.github/workflows/update-leaderboards.yml). Both carry their own
substance and only lose a pointer, so deleting this file means deleting those two `See` lines with
it.
