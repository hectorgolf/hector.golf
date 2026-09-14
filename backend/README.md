# hector.golf backend

This is an Express.js based REST API for the hector.golf website.

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

`GeneratePlayerAvatar` expects a JSON body with two fields:

- `photo`: source image of the player
- `sample`: style reference image

Each image field can be provided as one of:

- non-empty base64 string
- non-empty data URL string (for example `data:image/png;base64,...`)
- object with `data` or `base64`
- object with `inlineData` containing both `data` and `mimeType`

If either field is invalid, the function responds with HTTP `400` and a `details` array that explains validation errors.

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

| Status | When |
| ------ | ---- |
| `200`  | Upstream payload, with `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` |
| `400`  | `?event=` missing or not a plausible tournament id |
| `405`  | Anything other than `GET` or `OPTIONS` |
| `500`  | `HECTOR_APP_API_KEY` is not configured on the function |
| `502`  | Upstream refused or could not be reached (never cached, so the next poll retries) |

## Deploying

```bash
cd backend/backend-functions
npm run deploy:tournament-leaderboard
```

Needs `HECTOR_APP_API_KEY` in `.env` alongside the existing `GCLOUD_PROJECT_ID`.

All four deploy scripts name the target project on the command line
(`--project=$GCLOUD_PROJECT_ID`) and set the quota project for that one
invocation, so they never modify your active `gcloud` configuration. If you keep
more than one GCP context on one machine, deploying here leaves the other one
alone. Then
set the site's `PUBLIC_LEADERBOARD_PROXY_URL` repository variable to the deployed URL —
until that is set, the leaderboard pages render exactly as they did before.

### These scripts are still how keys get set

`.github/workflows/deploy-functions.yml` redeploys all four functions when code
lands on `main`, so a dependency bump or a code change no longer waits for
somebody to remember to run these. It deliberately passes no `--set-env-vars`,
though: `gcloud`'s env-var flags all mutate, and passing none leaves each
function's existing keys alone, which keeps `GOOGLE_GEMINI_API_KEY`,
`ASTROSITE_API_KEY` and `HECTOR_APP_API_KEY` out of GitHub entirely.

So the scripts above remain the way configuration changes. Run the matching one
by hand when a function is deployed for the first time, or when a key is
rotated. After that, code ships itself.

The workflow is also inert until its repository variables are set — these
functions are in a different GCP project from the one `terraform/` manages, so
it needs its own deploy identity. Its header says what to create.

Both limits come from that project split, not from the design. See
[docs/plans/functions-migration.md](../docs/plans/functions-migration.md) for the plan that
closes it, after which the keys live in Secret Manager and the workflow deploys
configuration along with code.

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
