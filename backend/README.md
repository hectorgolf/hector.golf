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

All four deploy scripts name the target project on the command line
(`--project=$GCLOUD_PROJECT_ID`) and set the quota project for that one
invocation, so they never modify your active `gcloud` configuration. If you keep
more than one GCP context on one machine, deploying here leaves the other one
alone. Then
set the site's `PUBLIC_LEADERBOARD_PROXY_URL` repository variable to the deployed URL —
until that is set, the leaderboard pages render exactly as they did before.

### CI ships these, configuration included

`.github/workflows/deploy-functions.yml` redeploys all four when code lands on
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
