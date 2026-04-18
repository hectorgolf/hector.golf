# Hector Golf Operations Cheat Sheet

Fast reference for common day-to-day operations.

## 1) Quick restart after a long break

1. Pull latest `main`.
2. Verify local env files exist:
   - `astrosite/.env`
   - `backend/backend-functions/.env`
3. Start website locally and confirm it loads:
   - `cd astrosite && npm install && npm run dev`
4. Run test suite:
   - `cd astrosite && npm test`
5. Run one data workflow script locally:
   - `cd astrosite && npm run update-leaderboards`
6. If backend work is needed, run one cloud function locally:
   - `cd backend/backend-functions && npm run dev:generate-player-biography`

## 2) Most-used commands

| Area | Command | Purpose |
| --- | --- | --- |
| Website | `cd astrosite && npm run dev` | Start local dev server |
| Website | `cd astrosite && npm run build` | Type-check and production build |
| Website | `cd astrosite && npm run preview` | Preview production build |
| Website | `cd astrosite && npm run test-unit` | Run unit tests |
| Website | `cd astrosite && npm run test-astro` | Run Astro/component tests |
| Website | `cd astrosite && npm test` | Run full test suite |
| Data workflows | `cd astrosite && npm run update-handicaps` | Refresh player handicap data |
| Data workflows | `cd astrosite && npm run update-leaderboards` | Refresh tournament leaderboards |
| Data workflows | `cd astrosite && npm run update-player-biographies` | Regenerate player biographies |
| Data workflows | `cd astrosite && npm run update-player-club-memberships` | Refresh player club memberships |
| Backend | `cd backend/backend-functions && npm run dev:scorecard-detection` | Run scorecard function locally |
| Backend | `cd backend/backend-functions && npm run dev:generate-player-biography` | Run biography function locally |
| Backend | `cd backend/backend-functions && npm run deploy:scorecard-detection` | Deploy scorecard function |
| Backend | `cd backend/backend-functions && npm run deploy:generate-player-biography` | Deploy biography function |
| Backend | `cd backend/backend-functions && npm run deploy:all` | Deploy all backend functions |

## 3) Manual runbook for scheduled jobs

All data jobs are GitHub Actions workflows under `.github/workflows/`.

- `update-handicaps.yml`
- `update-leaderboards.yml`
- `update-player-biographies.yml`
- `update-player-club-memberships.yml`
- `deploy.yml`

Manual trigger path via Github Actions:

1. Open GitHub repository `hectorgolf/hector.golf`.
2. Go to Actions.
3. Select workflow.
4. Click `Run workflow` and choose branch `main`.

Some of the aforementioned "update" workflows can also be run locally - see
`astrosite/package.json` for run scripts such as `npm run update-leaderboards`.

## 4) Local smoke tests for backend HTTP functions

Run from `backend/backend-functions/`.

Start function:

```sh
npm run dev:generate-player-biography
```

Call function (replace token):

```sh
curl -X POST http://localhost:8080/ \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ASTROSITE_API_KEY' \
  -d '{"name":"John","gender":"male","homeClub":"HGC","miscellaneousDetails":[],"previousAppearances":[],"hectorWins":[],"victorWins":[],"allPastEvents":[],"nextEvent":null,"retired":false}'
```

## 5) If something breaks, check these first

1. Wrong or missing env values (especially secrets, JSON formatting, and bearer token alignment).
2. Running commands from the wrong directory (`astrosite` vs `backend/backend-functions`).
3. Missing dependency install (`npm install` not run in the package you are using).
4. Data workflows failing due to third-party API credentials (WiseGolf/Teetime/Google).
5. Deploy confusion: website deploy and backend deploy are separate pipelines.
