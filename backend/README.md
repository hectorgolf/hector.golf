# hector.golf backend

This is an Express.js based REST API for the hector.golf website.

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

For example, when the function is deployed to `https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar`:

```bash
curl -X POST "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar" \
    -H "Authorization: Bearer <ASTROSITE_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
        "photo": "data:image/jpeg;base64,/9j/4AAQSk...",
        "sample": "data:image/png;base64,iVBORw0KGgo..."
    }'
```

## Example request (inlineData objects)

```bash
curl -X POST "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/GeneratePlayerAvatar" \
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
curl "https://europe-north1-gen-lang-client-0537211409.cloudfunctions.net/TournamentLeaderboard?event=HECTOR2026"
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

## Running it locally

```bash
cd backend/backend-functions
npm run start:tournament-leaderboard    # reads .env, serves on :8080
```

# Local CLI For GeneratePlayerAvatar

From [backend/backend-functions](backend/backend-functions), run:

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
