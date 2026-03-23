# hector.golf website (`astrosite`)

Astro + TypeScript project for the public hector.golf site.

It includes:

- Website pages and components
- Structured data under `src/data/`
- Local scripts/workflows that refresh data (handicaps, leaderboards, player biographies, club memberships)

## Prerequisites

- Node.js (same major as CI, currently Node 22/24)
- npm

## First-time setup

From this directory (`astrosite/`):

```sh
cp .env.sample .env
npm install
```

Then fill in real values in `.env`.

At minimum, keep a valid `.env` file present because tests and workflows use `env-cmd`.

## Local development

```sh
npm run dev
```

Site runs at <http://localhost:4321>.

Useful commands:

- `npm run build` - type-check + production build
- `npm run preview` - preview production build locally
- `npm run astro -- --help` - Astro CLI help

## Testing

```sh
# unit tests
npm run test-unit

# astro/component tests
npm run test-astro

# all tests
npm test
```

Notes:

- Unit tests include integration-style tests that may require working external credentials (see `.env.sample`).

## Data update playbooks

Each playbook updates files in `src/data/` and may create/update temporary commit message files used by `scripts/commit-changes.sh`.

### Update handicaps

```sh
npm run update-handicaps
```

Required env vars:

- `WISEGOLF_USERNAME`
- `WISEGOLF_PASSWORD`
- `TEETIME_CLUB_NUMBER`
- `TEETIME_USERNAME`
- `TEETIME_PASSWORD`

### Update leaderboards

```sh
npm run update-leaderboards
```

Required env vars:

- `GITHUB_ACCESS_TOKEN`
- `GOOGLE_CREDENTIALS` (single-line JSON string)

### Update player biographies

```sh
npm run update-player-biographies
```

Required env vars:

- `ASTROSITE_API_KEY` (must match the backend function's bearer token)
- `WISEGOLF_USERNAME`
- `WISEGOLF_PASSWORD`
- Optional: `DEBUG_GENAI_BIOGRAPHY=true`

### Update player club memberships

```sh
npm run update-player-club-memberships
```

Required env vars:

- `WISEGOLF_USERNAME`
- `WISEGOLF_PASSWORD`
- `TEETIME_CLUB_NUMBER`
- `TEETIME_USERNAME`
- `TEETIME_PASSWORD`

## Deployment model

- Live deployment is handled by GitHub Actions in `.github/workflows/deploy.yml`.
- Deploy runs automatically on:
  - Pushes to `main` that touch `astrosite/**/*` or workflow files
  - Scheduled runs (twice daily)
  - Manual workflow dispatch

Build target is GitHub Pages.

## Operational notes

- Scheduled data workflows are defined under `.github/workflows/update-*.yml`.
- Those workflows run scripts from `src/workflows/` and commit changed data back to the repo.
- Any data commit to `main` will trigger a site deployment.

## Troubleshooting quick checks

1. If scripts fail immediately, verify `.env` exists and contains all required keys.
2. If leaderboards fail, validate that `GOOGLE_CREDENTIALS` is valid JSON on one line.
3. If biography generation fails with 401, verify `ASTROSITE_API_KEY` matches the deployed backend setting.
4. If deploy did not run, check that changes landed on `main` and include files under `astrosite/`.
