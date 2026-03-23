# hector.golf

Monorepo for the hector.golf website and supporting cloud functions.

This repository is active only part of the year, so this README is optimized for quickly resuming work after a long break.

## Architecture overview

The system has two deployable parts:

1. `astrosite/` (Astro + TypeScript)
   - Static/public website content and pages
   - Data update workflows that write JSON under `astrosite/src/data/`
   - Deployed to GitHub Pages via `.github/workflows/deploy.yml`

2. `backend/backend-functions/` (Google Cloud Functions, Node.js)
   - `ExtractScorecardInformation` for scorecard OCR/understanding
   - `GeneratePlayerBiography` for AI-generated player biography text
   - Deployed to GCP (Gen2 Cloud Functions)

Data flow in practice:

- Scheduled/manual GitHub Actions workflows run scripts in `astrosite/src/workflows/`.
- Those scripts refresh data files in `astrosite/src/data/` and commit changes.
- Changes in `astrosite/` trigger the website deployment workflow.
- The biography workflow calls the live `GeneratePlayerBiography` cloud function.

## Repository layout

```text
.
├── astrosite/                 # Website, content, workflows, tests
├── backend/
│   └── backend-functions/     # GCP functions source code and deploy scripts
└── .github/workflows/         # Deploy + scheduled data update automation
```

## Quick start (most common)

### Work on website locally

```sh
cd astrosite
cp .env.sample .env
npm install
npm run dev
```

Then open <http://localhost:4321>.

### Work on cloud functions locally

```sh
cd backend/backend-functions
npm install
# create .env with required keys (see backend/README.md)
npm run dev:generate-player-biography
```

## Day-to-day playbooks

- Frontend/website operations and local workflows:
  - See `astrosite/README.md`
- Backend cloud function local run/deploy playbooks:
  - See `backend/README.md`

## CI/CD overview

- Website deploys from `.github/workflows/deploy.yml`:
  - On push to `main` when `astrosite/**/*` (or workflows) changed
  - On schedule (twice daily) and manual dispatch
- Data refresh workflows (handicaps, leaderboards, biographies, memberships):
  - Run on schedule and manual dispatch
  - Commit data updates back to repository

## Suggested restart routine after a long break

1. Pull latest `main`.
2. Read `astrosite/README.md` and `backend/README.md` once.
3. Verify local `.env` files exist and secrets are still valid.
4. Run tests in `astrosite`.
5. Run one workflow script locally (for example leaderboards) to confirm credentials.
6. If backend work is needed, run one function locally and test with `curl`.
