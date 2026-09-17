# Migrating the Cloud Functions into `hector-golf`

*Executed 2026-09-14, all but one step. This is the short version. The 600-line plan it replaces is
in this file's history, and the reasoning worth keeping has moved to the code it governs — see
[Where the detail went](#where-the-detail-went).*

## Why

The four Cloud Functions ran in `gen-lang-client-0537211409` — the project Google AI Studio creates
alongside a Gemini API key — while everything else is in `hector-golf`: Firestore, the admin
service, Artifact Registry, the scheduler jobs, the Terraform state bucket. Nobody chose that split,
and it cost four things. There were no CI deploys, because the deploy identity would have had to
live in a project Terraform does not manage. Three API keys were set by `--set-env-vars` from
somebody's laptop, because Secret Manager was in the other project. Gemini spend was invisible to
the budget alert, which filters on `hector-golf`. And no Terraform described any of it, so the only
record of what the functions were was the `deploy:*` scripts. Moving the compute was possible at all
because an API key is a bearer credential rather than a project binding — nothing checks where the
caller runs — so the only hard constraint was that the URLs change.

## Done

The phase numbers are kept because `iam.tf`, `secrets.tf`, `outputs.tf` and `deploy-functions.yml`
cite them.

| phase | when | what |
| --- | --- | --- |
| 1 | 2026-09-14 | **Terraform** — the APIs, a runtime and a deploy identity, a WIF binding on the *existing* pool, three Secret Manager containers, and the outputs feeding the `GH_FUNCTIONS_*` variables |
| 2–3 | 2026-09-14 | **A new Gemini key** in `hector-golf`, restricted to `generativelanguage.googleapis.com`, plus the three secret values added by hand. Terraform creates the containers and never the values |
| 4–5 | 2026-09-14 | **All four functions deployed and verified**, reading their keys from Secret Manager instead of from `--set-env-vars` |
| 6 | 2026-09-14 | **Cutover** — the `PUBLIC_LEADERBOARD_PROXY_URL` repository variable, the hardcoded URL in `update-player-biographies.ts`, and the documentation |
| 8 | 2026-09-14 | **CI deploys on** — `deploy-functions.yml` lost its guard job and now ships configuration as well as code, on the same WIF pool as every other workflow |
| 7 | 2026-09-17 | **The four old functions deleted.** `gcloud functions list` on the old project returns nothing, and the old alias answers 404. Its remaining step is below |

The URLs moved from `https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/<Name>` to
`https://europe-north1-hector-golf.cloudfunctions.net/<Name>`. A gen2 function also answers on a
generated `run.app` hostname; the repository standardises on the `cloudfunctions.net` alias, because
it is derivable from the project and function name rather than having to be read back after a
deploy.

## What remains

**One credential: the old Gemini key.** `Generative Language API Key`, created 2024-08-28, key id
`7e0ddaae-d620-43a7-ba5b-a834e1d0819b`, in `gen-lang-client-0537211409`.

**When: any time.** This step was originally gated on a week of silence from the old functions.
That gate is spent — the functions that were the key's only consumers have been gone since
2026-09-17, and the delete command runs its own usage check regardless.

```bash
# Two keys are listed. Only the Generative Language one is in scope.
gcloud services api-keys list --project=gen-lang-client-0537211409 \
  --format="table(displayName,name.basename(),createTime)"

gcloud services api-keys delete 7e0ddaae-d620-43a7-ba5b-a834e1d0819b \
  --project=gen-lang-client-0537211409
```

What that step entails:

- **If something forgotten still uses the key, the delete says so.** `--check-existing-usage`
  defaults to *true*, so a key with traffic in the last seven days fails with an error instead of
  going quietly. Do not reach for `--no-check-existing-usage` when it complains: that failure is the
  only warning you get.
- **It is reversible for 30 days.** Deleted keys are retained that long, and
  `gcloud services api-keys undelete` takes one back given the key id or `--key-string`. Keep the id
  above until the window closes.
- **Nothing in `hector-golf` is affected.** The three Gemini functions read `Gemini (Cloud
  Functions)`, minted there on 2026-09-14, out of Secret Manager.
- **`Browser key (auto created by Firebase)` is not in scope.** It belongs to the Firestore database
  that is staying.

Once the key is gone this plan is finished and can leave `plans/`, per the lifecycle note in
[`../README.md`](../README.md).

## What is deliberately not happening

**`gen-lang-client-0537211409` is not deleted.** It holds `hector-firestore`, and Firestore's free
tier is granted per project: that allowance is only usable inside that project and is spent the
moment the database is deleted, so deleting the project would throw it away to save nothing. An
empty project with a scaled-to-zero database costs nothing to keep. A stray-project sweep should
expect to keep finding this one, and finding it is not a loose end — the general form of the
argument is in [`../playbooks/gcp-bootstrapping.md`](../playbooks/gcp-bootstrapping.md).

Two APIs also stay enabled there, `cloudfunctions.googleapis.com` and
`generativelanguage.googleapis.com`. An enabled API with no traffic bills nothing, so they are a
note rather than a task.

## Where the detail went

The phases above were argued at length while they were pending. None of that reasoning was dropped
without a home closer to the thing it governs:

| what | now lives in |
| --- | --- |
| Why the deploy identity holds two roles, and not `storage.objectAdmin` or `run.admin` | [`terraform/iam.tf`](../../terraform/iam.tf) |
| Why `generativelanguage.googleapis.com` must be enabled where the *key* lives, not where the caller runs | [`terraform/apis.tf`](../../terraform/apis.tf) |
| Why every deploy names `--build-service-account`, and why none passes `--allow-unauthenticated` | [`deploy-functions.yml`](../../.github/workflows/deploy-functions.yml) |
| What Terraform owns and what CI deploys, and the state of the estate | [`current/gcp-setup.md`](../current/gcp-setup.md) |
| Not deleting a stray auto-created project | [`playbooks/gcp-bootstrapping.md`](../playbooks/gcp-bootstrapping.md) |
