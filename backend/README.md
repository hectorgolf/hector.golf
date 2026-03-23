# hector.golf backend

Google Cloud Functions backend used by the hector.golf site.

Current functions:

- `ExtractScorecardInformation`
- `GeneratePlayerBiography`

Source code is under `backend-functions/`.

## Prerequisites

- Node.js (runtime/deploy target is Node 24)
- npm
- Google Cloud SDK (`gcloud`) authenticated to the right account/project
- Optional for local HTTP function hosting: `@google-cloud/functions-framework` (already in dependencies)

## Setup

From `backend/backend-functions/`:

```sh
npm install
```

Create `.env` in `backend/backend-functions/` with at least:

```dotenv
GCLOUD_PROJECT_ID=your-gcp-project-id
GOOGLE_GEMINI_API_KEY=your-gemini-api-key
ASTROSITE_API_KEY=shared-bearer-token-used-by-astrosite
```

## Local development playbooks

Run from `backend/backend-functions/`.

### 1) Run scorecard function locally

```sh
npm run dev:scorecard-detection
```

Then call it:

```sh
curl -X POST http://localhost:8080/ \
    -H 'Content-Type: application/json' \
    -d '{"image":"<base64-image>","mime":"image/png","version":1}'
```

### 2) Run biography function locally

```sh
npm run dev:generate-player-biography
```

Then call it:

```sh
curl -X POST http://localhost:8080/ \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer YOUR_ASTROSITE_API_KEY' \
    -d '{"name":"John","gender":"male","homeClub":"HGC","miscellaneousDetails":[],"previousAppearances":[],"hectorWins":[],"victorWins":[],"allPastEvents":[],"nextEvent":null,"retired":false}'
```

The bearer token must match `ASTROSITE_API_KEY` in `.env`.

### 3) CLI helper for scorecard extraction (image file input)

```sh
npm run cli
```

## Deployment playbooks

Run from `backend/backend-functions/`.

### Deploy scorecard function

```sh
npm run deploy:scorecard-detection
```

### Deploy biography function

```sh
npm run deploy:generate-player-biography
```

### Deploy both

```sh
npm run deploy:all
```

These scripts:

1. Build TypeScript output to `dist/`
2. Load `.env`
3. Set active GCP project from `GCLOUD_PROJECT_ID`
4. Deploy Gen2 HTTP functions in region `europe-north1`

## Operational notes

- Both functions are configured as unauthenticated HTTP endpoints at cloud level.
- `GeneratePlayerBiography` still enforces bearer-token auth in application logic.
- No dedicated backend test suite is currently wired in this package.

## Troubleshooting

1. `gcloud` deploy failures: run `gcloud auth login` and `gcloud auth application-default login`.
2. `401 Valid API key required` from biography function: check `Authorization: Bearer ...` header and `ASTROSITE_API_KEY` alignment.
3. Missing API key runtime errors: verify `.env` values and shell export behavior.
