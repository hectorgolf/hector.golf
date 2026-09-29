# hector.golf backend

This is not an application. It is one npm package that builds four independent,
HTTP-triggered **GCP Cloud Functions gen2** — no Express app, no router, no database,
no shared state. `@google-cloud/functions-framework` supplies Express-compatible
request and response types and nothing else.

One of the four is public (`TournamentLeaderboard`, polled by the website's live
leaderboard from a visitor's browser) and three are private, requiring
`Authorization: Bearer <ASTROSITE_API_KEY>`. Two of those three —
`GeneratePlayerAvatar` and `ExtractScorecardInformation` — are experiments that are
deployed but called by nothing; see [docs/experiments/](../docs/experiments/).

[docs/current/architecture.md §10](../docs/current/architecture.md) is the full
description: what each function is for, how the private ones authenticate, and how
deployment and secrets work.

# Configuration

Copy [`backend-functions/.env.sample`](backend-functions/.env.sample) to
`backend-functions/.env` and fill in the values. `.env` is gitignored and has to stay
that way: three of the five values are live credentials, and this repository is public.

Every `deploy:*` and `start:*` script sources that file. They do it with
`set -a && . ./.env && set +a` rather than `export $(cat .env | xargs)`, which cannot
read a file with comments in it — `xargs` fails and every variable silently comes out
empty, which for a deploy means `--set-env-vars GOOGLE_GEMINI_API_KEY=` and a function
that ships without its key.

# Tests

```bash
cd backend/backend-functions
npm install
npm test
```

Three suites, in rising order of cost and of how much they prove:
`test/unit` calls modules directly, `test/functions` drives each handler over real HTTP
through the Functions Framework's own server, and `test/deployment` builds `dist/` and
starts the framework CLI against it for every `--entry-point` the deploy scripts name,
resolving it exactly the way `gcloud` will. None of them reach the network, GCP, or
Gemini. See [backend-functions/test/README.md](backend-functions/test/README.md).

# The `uuid` override

`package.json` pins `uuid` to `11.1.1` through an `overrides` block. It is the
only override here, and it is worth knowing why before deleting it.

`uuid` is not a dependency of ours. It arrives as
`@google-cloud/functions-framework` → `cloudevents` → `uuid@^8.3.2`, and 8.3.2 is
subject to [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq):
`v3()`, `v5()` and `v6()` write into a caller-supplied buffer without checking its
bounds, so an undersized buffer is partly filled instead of throwing the
`RangeError` that `v4()` raises. Nothing here calls those, but the advisory is
what Dependabot sees.

The usual fix does not exist. `@google-cloud/functions-framework@5.0.5` and
`cloudevents@10.0.0` are both the newest published releases, and `cloudevents`
still asks for `uuid@^8.3.2`, so there is no version to upgrade to and an
override is the whole of the remedy.

`11.1.1` rather than the newest `14.0.0` because `cloudevents` is CommonJS and
reaches `uuid` by `require("uuid")`. The 11.x line is the last one that ships a
CommonJS build; 12, 13 and 14 are ESM-only. All four lines carry the fix — it was
backported to 11.1.1, 12.0.1 and 13.0.1 — so staying on 11 costs nothing but the
newer majors.

Remove the block once `cloudevents` ships a release that asks for a patched
`uuid` itself. `test/deployment` is the suite that would notice if the override
ever broke the framework, since it boots the Functions Framework CLI against a
real build.

# GeneratePlayerAvatar API

*An experiment, deployed but unused — see
[docs/experiments/player-avatar-generation.md](../docs/experiments/player-avatar-generation.md)
for why. The API below is accurate; nothing calls it.*

`GeneratePlayerAvatar` expects a JSON body with two fields:

- `photo`: source image of the player
- `sample`: style reference image

Each image field can be provided as one of:

- non-empty base64 string
- non-empty data URL string (for example `data:image/png;base64,...`)
- object with `data` or `base64`
- object with `inlineData` containing both `data` and `mimeType`

If either field is invalid, the function responds with HTTP `400` and a `details` array that
explains validation errors.

## Example request (data URL strings)

For example, when the function is deployed to `https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerAvatar`:

```bash
curl -X POST "https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerAvatar" \
    -H "Authorization: Bearer <ASTROSITE_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
        "photo": "data:image/jpeg;base64,/9j/4AAQSk...",
        "sample": "data:image/png;base64,iVBORw0KGgo..."
    }'
```

## Example request (inlineData objects)

```bash
curl -X POST "https://europe-north1-hector-golf.cloudfunctions.net/GeneratePlayerAvatar" \
    -H "Authorization: Bearer <ASTROSITE_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
        "photo": {
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": "/9j/4AAQSk..."
            }
        },
        "sample": {
            "inlineData": {
                "mimeType": "image/png",
                "data": "iVBORw0KGgo..."
            }
        }
    }'
```

## Example success response

```json
{
    "avatar": "iVBORw0KGgoAAAANSUhEUgAA...",
    "mimeType": "image/png"
}
```

## Example validation error response

```json
{
    "error": "Invalid payload",
    "message": "Expected a JSON body with valid photo and sample image payloads.",
    "details": [
        "photo.inlineData.mimeType must be a non-empty string.",
        "sample object must include one of: data, base64, or inlineData."
    ]
}
```

# TournamentLeaderboard API

`TournamentLeaderboard` is a public, cacheable read of an app.hector.golf tournament
payload. It exists so the website's live leaderboard can poll the standings from a
visitor's browser: app.hector.golf requires an `x-api-key`, and hector.golf is a
static site, so the key stays in this function rather than in page source.

It returns the upstream payload **verbatim**. All the reading and normalising happens
in the site's own code (`astrosite/src/code/leaderboards/app-payload.ts`), which is
where the tests for it live.

It is not an open proxy: the upstream URL is a fixed template and the only thing a
caller controls is the `event` parameter, constrained to `^[A-Za-z0-9_-]{1,64}$`. The
same pattern is kept in `astrosite/src/code/leaderboards/sources.ts`.

## Request

```bash
curl "https://europe-north1-hector-golf.cloudfunctions.net/TournamentLeaderboard?event=HECTOR2026"
```

No authentication: the standings are published on the public website anyway. Browser
access is limited by CORS to the hector.golf origins plus localhost for development.

## Responses

| Status | When                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| `200`  | Upstream payload, with `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` |
| `400`  | `?event=` missing or not a plausible tournament id                                                  |
| `405`  | Anything other than `GET` or `OPTIONS`                                                              |
| `500`  | `HECTOR_APP_API_KEY` is not configured on the function                                              |
| `502`  | Upstream refused or could not be reached (never cached, so the next poll retries)                   |

## Deploying

```bash
cd backend/backend-functions
npm run deploy:tournament-leaderboard
```

Needs `GCLOUD_PROJECT_ID` in `.env`. It no longer needs `HECTOR_APP_API_KEY`:
the function reads that from Secret Manager, and the deploy only names the
secret.

All five deploy scripts name the target project on the command line
(`--project=$GCLOUD_PROJECT_ID`) and set the quota project for that one
invocation, so they never modify your active `gcloud` configuration. If you keep
more than one GCP context on one machine, deploying here leaves the other one
alone. Then
set the site's `PUBLIC_LEADERBOARD_PROXY_URL` repository variable to the deployed URL —
until that is set, the leaderboard pages render exactly as they did before.

### CI ships these, configuration included

`.github/workflows/deploy-functions.yml` redeploys all five when code lands on
`main`, and it deploys *configuration* as well as code: every deploy states
`--service-account` and `--set-secrets`, so a function's identity and its keys
are whatever the workflow says rather than whatever the last laptop set.

The scripts above are therefore a convenience rather than the only path. They
pass the same flags, so a laptop deploy and a CI deploy produce the same
function.

**Rotating a key no longer involves a deploy at all.** Add a new version and the
functions pick it up, because they reference `:latest`:

```bash
printf %s "$NEW_KEY" | gcloud secrets versions add gemini-api-key --project=hector-golf --data-file=-
```

A redeploy only shortens the wait for existing warm instances. Nothing here ever
holds the value: `--set-secrets` names a container, so no key passes through
this repository, a GitHub secret or a CI runner.

This was not true before 2026-09-14, when the functions lived outside the
Terraform-managed project and their keys reached them by `--set-env-vars` from
somebody's `.env`.

## Running it locally

```bash
cd backend/backend-functions
npm run start:tournament-leaderboard    # reads .env, serves on :8080
```

# RequestLeaderboardUpdate API

`RequestLeaderboardUpdate` is how app.hector.golf asks hector.golf to republish a
tournament's standings the moment a score changes. It checks an API key and then calls
the admin service's `POST /api/jobs/leaderboards/run`, which does the work in the
request and commits the new board.

Without it, the published leaderboard moves at the Cloud Scheduler tick — four times a
day — which is not a live leaderboard.

## Why there is a relay at all

The admin service is behind IAP, which admits Google principals presenting an ID token
signed for the audience of the OAuth client in front of the service. app.hector.golf is
somebody else's system and holds no Google credential.

The choices were a Google service account key on their side, or a shim on ours that
speaks both. This is the shim: an API key in, a Google-signed token out.

It is **not** a way past IAP. The relay goes in the same front door as Cloud Scheduler
and the admins, as its own service account — `hector-leaderboard-trigger`, the only
function identity holding `roles/iap.httpsResourceAccessor` — and the admin still reads
the caller's identity from IAP's header. There is no second ingress and no
`run.invoker` binding that skips the proxy.

## Asking for an update

```bash
curl -X POST "https://europe-north1-hector-golf.cloudfunctions.net/RequestLeaderboardUpdate" \
  -H "x-api-key: $LEADERBOARD_TRIGGER_KEY" \
  -H "Content-Type: application/json" \
  --data '{}'
```

`POST` only: a `GET` that publishes a leaderboard is one link preview away from
publishing a leaderboard.

There is no body to send and no event to name. The admin refreshes every Hector that is
being played and whose standings live on app.hector.golf, which today is at most one.
Letting the caller name an event would be a parameter the admin has to defend against
rather than a capability anybody needs.

The key is **not** `HECTOR_APP_API_KEY`. That one is app.hector.golf's key, for us to
call them; this is ours, for them to call us. They rotate independently, which is the
point of there being two.

## What it answers

The admin's own status and body are passed straight through, because they already say
what a caller needs in order to decide whether to retry.

| Status | When                                                                                      |
| ------ | ----------------------------------------------------------------------------------------- |
| `200`  | The job ran. The body says what it did, including when that was finding nothing to change |
| `401`  | No `x-api-key`, or the wrong one. Deliberately the same answer for both                   |
| `405`  | Anything other than `POST`                                                                |
| `409`  | Another run is already going. Not worth retrying: it publishes the same standings         |
| `500`  | The relay is not configured, or could not mint an identity token                          |
| `502`  | The job failed, e.g. app.hector.golf could not be read. The board is unchanged            |
| `503`  | The admin has no app.hector.golf key configured. A setup step, not a wait                 |
| `504`  | The admin could not be reached within 60 seconds                                          |

A `409` is the expected answer to a burst: the admin takes a lease, so two pushes a
second apart produce one run and one refusal rather than two racing commits.

## Deploying the relay

```bash
cd backend/backend-functions
npm run deploy:request-leaderboard-update
```

Needs `GCLOUD_PROJECT_ID`, `ADMIN_DOMAIN` and `IAP_CLIENT_ID` in `.env`. The last two are
configuration rather than secrets — a hostname, and an OAuth client id that appears in
IAP's own sign-in URL — so unlike every other value here they are passed as
`--set-env-vars`. The key itself comes from Secret Manager, as the others do.

### The first deploy is a three-step dance

Only the first, and only on a project that has never had this function. It is written down
because it cost a red build on 2026-09-28 and the failure does not look like an ordering
problem — it looks like two unrelated breakages arriving at once.

This function is the only one whose deploy depends on Terraform, and Terraform's last
resource for it depends on the deploy:

- `--service-account=hector-leaderboard-trigger@…` is an account `terraform/iam.tf`
  creates. Deploying before the apply fails with `Service account … was not found`.
- The `allUsers` invoker binding in `terraform/cloud_run.tf` names the Cloud Run service
  the deploy creates. Applying before the deploy fails with
  `Error 404: Resource 'requestleaderboardupdate' of kind 'SERVICE' … does not exist`.

Neither can go first, so it goes twice:

1. **Apply.** Creates the service account, the secret container and the grants. The
   invoker binding fails; that failure is expected and nothing else is wrong.
2. **Create the key, then deploy.** Terraform makes containers and deliberately never
   values, so the secret exists with no version — and `--set-secrets=…:latest` against a
   versionless secret fails the deploy. The key comes first:

   ```bash
   openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add leaderboard-trigger-key \
     --project=hector-golf --data-file=-
   ```

3. **Apply again.** The service exists now, so the binding lands. Until it does, the
   function is deployed and answers 403 to everyone, app.hector.golf included.

Both CI workflows fire on the same merge and neither waits for the other, so on the merge
that introduces this function you get a failed apply *and* a failed deploy. That is one
problem, not two, and re-running them in the order above is the whole of the fix.
`.github/workflows/deploy-functions.yml` says the same thing at the point the red build
appears.

Then give the key to app.hector.golf out of band, the way they gave us theirs. Rotating it
later is step 2's command on its own: the function references `:latest`, so a new instance
picks it up with no redeploy.

## Running the relay locally

```bash
cd backend/backend-functions
npm run start:request-leaderboard-update    # reads .env, serves on :8080
```

It will not get far on a laptop: minting the ID token needs the GCP metadata server,
which is not there. What a local run does answer is everything above that point — the
method check, the key check, and what an unconfigured deployment says.

# Round hook API

Not a Cloud Function — it lives on the **hooks service**, which is the admin's own image
running with no IAP in front of it and serving this one route. It is documented here because
this is where app.hector.golf's other endpoint is, and whoever is wiring one up wants both.

`POST /api/hooks/round` is where app.hector.golf reports that a round has started or ended,
or that the event is over. Each one republishes the standings immediately instead of waiting
for the next scheduled tick.

## The two endpoints, side by side

They are separate signals with separate keys, and both are wanted:

| | URL | Key | Send it when |
| --- | --- | --- | --- |
| Score changed | `https://europe-north1-hector-golf.cloudfunctions.net/RequestLeaderboardUpdate` | `leaderboard-trigger-key` | A score was entered or corrected |
| Round boundary | `https://hector-hooks-6uxopx7tjq-lz.a.run.app/api/hooks/round` | `hooks-api-key` | A round opened or closed, or the event ended |

## Sending a signal

A round has just finished:

```bash
curl -X POST "https://hector-hooks-6uxopx7tjq-lz.a.run.app/api/hooks/round" \
  -H "x-api-key: $HOOKS_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"phase": "round-ended", "event": "HECTOR2026", "round": 3}'
```

A round is starting:

```bash
curl -X POST "https://hector-hooks-6uxopx7tjq-lz.a.run.app/api/hooks/round" \
  -H "x-api-key: $HOOKS_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"phase": "round-started", "event": "HECTOR2026", "round": 4}'
```

The whole event is over:

```bash
curl -X POST "https://hector-hooks-6uxopx7tjq-lz.a.run.app/api/hooks/round" \
  -H "x-api-key: $HOOKS_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"phase": "event-ended", "event": "HECTOR2026"}'
```

`phase` is required and must be one of `round-started`, `round-ended`, `event-ended`.
`event` and `round` are **optional**: they are recorded in our run log so that a published
change can be explained later, and they do not steer anything. What gets refreshed is decided
our end, from the tournament data — so a wrong or missing `event` cannot cause the wrong board
to be published, and cannot stop the right one being.

`Content-Type: application/json` is required. A POST that arrives without one is rejected by
the framework before our code sees it.

## What comes back

```json
{"ran":"leaderboards","phase":"round-ended","outcome":"ok",
 "detail":"the standings for HECTOR2026 are unchanged","changes":0}
```

| Status | What it means                                                                      | Retry?               |
| ------ | ---------------------------------------------------------------------------------- | -------------------- |
| `200`  | The job ran. `detail` says what it did, including finding nothing to change        | No                   |
| `400`  | `phase` missing or unrecognised, or `event`/`round` malformed. `detail` says which | No — fix the request |
| `401`  | No `x-api-key`, or the wrong one. Same answer for both                             | No                   |
| `405`  | Anything other than `POST`. `Allow: POST`                                          | No                   |
| `409`  | A run was already going. It publishes the same board                               | **No**               |
| `500`  | A fault our end                                                                    | Yes, with backoff    |
| `502`  | The job failed, e.g. app.hector.golf could not be read. The board is unchanged     | Yes, with backoff    |
| `503`  | The admin has no app.hector.golf key configured. A setup step our end              | Yes, slowly          |

**A `409` is a normal answer, not a failure.** Two signals seconds apart — a round ending as
another starts — produce one run and one refusal, because a lease means only one refresh
happens at a time. The run already going reads the same upstream and publishes the same board,
so the right thing to do with a `409` is drop it.

**`"no tournament on app.hector.golf is being played today"` with a `200` is also success.**
Outside an event there is nothing to refresh, so that is what a test call will say. A `200`
means the hook worked, whatever the `detail` says.

## Checking it without sending a real signal

No key needed, and it starts nothing:

```bash
curl -i "https://hector-hooks-6uxopx7tjq-lz.a.run.app/api/hooks/round"
```

`405 {"error":"method_not_allowed"}` with `Allow: POST` means the endpoint is reachable and
healthy. With a key, the cheapest real call is any valid phase: outside an event it publishes
nothing.

A wrong key is `401 {"error":"unauthorized"}` — the same answer as no key at all, deliberately.

# Local CLI For GeneratePlayerAvatar

From [backend/backend-functions](backend-functions), run:

```bash
npm run cli:generate-player-avatar -- <photo-file> <sample-file> [output-file]
```

Example:

```bash
cd backend/backend-functions
npm run cli:generate-player-avatar -- ../samples/player.jpg ../samples/style.png ./generated-avatar.png
```

Notes:

- The CLI loads environment variables from `.env` automatically.
- It uses `ASTROSITE_API_KEY` for authentication.
- It uses `GENERATE_PLAYER_AVATAR_URL` if set.
- If `GENERATE_PLAYER_AVATAR_URL` is not set, it builds the URL from `FUNCTION_REGION` and `GCLOUD_PROJECT_ID`.
- The generated image is written to `[output-file]` (defaults to `generated-avatar.png`).
