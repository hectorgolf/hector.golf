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

## Decisions before the migration runs

These block `docs/functions-migration.md`, which is written but unexecuted.

**Migrate first, or activate `deploy-functions.yml` where the functions are now?** The workflow ships
inert because its deploy identity would have to live in `gen-lang-client-0537211409`. Standing up a
second Workload Identity pool in a project the plan then deletes is throwaway work, so the
recommendation is to migrate first. If the migration is months away, activating it in the old
project is the better trade.

**Should Terraform own the functions themselves?** The plan has Terraform manage the APIs,
identities and secret containers while CI deploys the functions wholesale with `gcloud` — the same
split as `deploy-admin.yml`, which deploys revisions while Terraform owns the Cloud Run service.
Managing `google_cloudfunctions2_function` instead would put the source bundle in Terraform's hands
and fight the deploy workflow. Choosing that changes phases 1 and 8 substantially.

**Check €2/month against real Gemini spend.** `budget_amount_eur` was raised from 1 to 2 on the
reasoning that Gemini billing lands in this project after the migration and `gemini-2.5-flash-image`
behind `GeneratePlayerAvatar` is not free. Nobody has looked at what the old project actually spends.
If it is already above €1/month, the 50% threshold will fire on ordinary use and the alert stops
being worth reading.

**Find out what else lives in `gen-lang-client-0537211409`.** Phase 7 offers to delete the project.
If a Firestore database was ever created there by accident it is holding that project's free-tier
allowance, and deleting throws it away — `docs/gcp-setup-playbook.md` has the sweep that finds one.

**Confirm whether both projects bill to the same account.** It decides whether the migration changes
anything about billing beyond which budget filter can see the spend.

## Documentation

**The CI/CD table in `docs/architecture.md` §9 is missing rows.** `admin-checks.yml`,
`backend-checks.yml`, `export-admin-data.yml` and `refresh-admin-mirror.yml` are not in it. Noticed
while adding `deploy-functions.yml` to that table; left alone at the time to keep the diff narrow.
