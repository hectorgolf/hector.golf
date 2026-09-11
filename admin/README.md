# hector-admin

The admin UI and API for hector.golf. Runs on Cloud Run in `europe-north1`, behind
Identity-Aware Proxy, against the `hector` Firestore database.

Nothing is built here yet beyond a status page. It exists so the deployment path
is real and tested before there is anything to lose by it being wrong.

## Running it locally

```bash
npm install
npm run dev          # tsx watch, http://localhost:8080
```

Firestore will report itself unreachable, because nothing has given the process
credentials. That is the intended behaviour rather than a failure: the page says
so and keeps serving. To talk to the real database:

```bash
gcloud auth application-default login    # as an account with roles/datastore.user
FIRESTORE_DATABASE_ID=hector npm run dev
```

`FIRESTORE_DATABASE_ID` matters. Unset, the client falls back to `(default)`,
which is a *different database* from the one Terraform created — and on a project
whose free tier is already spoken for, creating it by accident is not free. In the
deployed service the value comes from `terraform/cloud_run.tf`, wired from the
database resource so the two cannot disagree.

```bash
npm run typecheck
npm test             # no credentials, no network, no emulator
npm run build        # tsc -> dist/
```

## What it looks like in production

| Route | |
| --- | --- |
| `GET /` | Status page: who IAP says you are, whether Firestore answers |
| `GET /healthz` | Liveness. Touches nothing — a probe that depends on Firestore turns a blip into a restart loop |
| `GET /readyz` | Readiness. Does touch Firestore, and returns 503 when it cannot |

## Authentication

This service does not authenticate anyone, and must not be deployed anywhere that
assumes it does. Two things in front of it do the work:

- **Cloud Run IAM** — only the IAP service agent holds `roles/run.invoker`, so a
  request that did not come through IAP never reaches the process.
- **IAP** — enforces on every hostname the service answers to, including the
  default `run.app` URL, and admits only the principals in `admin_principals`.

`src/identity.ts` therefore reads `x-goog-authenticated-user-email` and trusts it.
That trust is a property of the deployment, not of this code. Verifying the signed
JWT in `x-goog-iap-jwt-assertion` is the hardening step, and is worth doing before
this service accepts its first write; it is deliberately absent rather than
half-present, because a signature check that does not verify reads as assurance it
does not provide.

## Deployment

[`.github/workflows/deploy-admin.yml`](../.github/workflows/deploy-admin.yml) builds
the image in the runner, pushes it to Artifact Registry tagged with the commit SHA
and `latest`, and rolls out a Cloud Run revision. It runs on pushes to `main` that
touch `admin/**`.

Terraform owns the service; this workflow owns the image it runs — see the
`lifecycle` block in `terraform/cloud_run.tf`. The two do not fight.
