# Environment Variables Reference

This file documents environment variables used by this repository, where they are consumed, and where they are expected to come from.

## 1) Astro site (`astrosite`)

Primary local env file: `astrosite/.env` (template: `astrosite/.env.sample`).

| Variable | Required locally | Required in GitHub Actions | Used by | Purpose | Source in CI |
| --- | --- | --- | --- | --- | --- |
| `WISEGOLF_USERNAME` | Yes for WiseGolf-backed workflows/tests | Yes | `astrosite/src/code/handicaps/wisegolf-api.ts`, build in `deploy.yml` | Authenticate to WiseGolf APIs | Hardcoded in workflows (non-secret value) |
| `WISEGOLF_PASSWORD` | Yes for WiseGolf-backed workflows/tests | Yes | `astrosite/src/code/handicaps/wisegolf-api.ts` | Authenticate to WiseGolf APIs | `${{ secrets.WISEGOLF_PASSWORD }}` |
| `TEETIME_CLUB_NUMBER` | Yes for Teetime-backed workflows | Yes | Handicap and membership workflows | Teetime club context | Hardcoded in workflows |
| `TEETIME_USERNAME` | Yes for Teetime-backed workflows | Yes | Handicap and membership workflows | Teetime user identity | Hardcoded in workflows |
| `TEETIME_PASSWORD` | Yes for Teetime-backed workflows | Yes | Handicap and membership workflows | Teetime authentication | `${{ secrets.TEETIME_PASSWORD }}` |
| `GITHUB_ACCESS_TOKEN` | Yes for leaderboard workflow | Yes | `astrosite/src/workflows/update-leaderboards.ts` and GitHub leaderboard source code | Authenticate GitHub API calls | `${{ secrets.GITHUB_TOKEN }}` |
| `GOOGLE_CREDENTIALS` | Yes for leaderboard workflow | Yes | `astrosite/src/code/leaderboards/google-sheets.ts` | Google Sheets service account credentials (JSON string, one line) | `${{ secrets.GCP_SERVICE_ACCOUNT_CREDENTIALS }}` |
| `ASTROSITE_API_KEY` | Yes for biography workflow | Yes | `astrosite/src/workflows/update-player-biographies.ts` | Bearer token when calling backend biography function | `${{ secrets.ASTROSITE_API_KEY }}` |
| `DEBUG_GENAI_BIOGRAPHY` | Optional | Optional | `astrosite/src/workflows/update-player-biographies.ts` | Extra debug logging for biography generation | Not configured by default |

Notes:

- `npm test` in `astrosite` uses `env-cmd`, so `.env` must exist.
- `GOOGLE_CREDENTIALS` must be valid JSON and represented as a single-line string.

## 2) Backend cloud functions (`backend/backend-functions`)

Primary local env file: `backend/backend-functions/.env`.

| Variable | Required locally | Required for deploy | Used by | Purpose |
| --- | --- | --- | --- | --- |
| `GCLOUD_PROJECT_ID` | Yes for deploy scripts | Yes | Deploy npm scripts in `backend/backend-functions/package.json` | Sets active GCP project before deploy |
| `GOOGLE_GEMINI_API_KEY` | Yes | Yes | `GeneratePlayerBiography`, `ExtractScorecardInformation`, CLI helper | Gemini API access |
| `ASTROSITE_API_KEY` | Yes for biography function | Yes for biography deploy | `backend/backend-functions/src/functions/generate-player-biography/index.ts` | Bearer token check for biography endpoint |
| `API_KEY` | Optional/special-case | Optional | `backend/backend-functions/src/lib/prompts/scorecard-detection/genai.ts` (file upload path) | Used by `GoogleAIFileManager` for large-image upload path |

Notes:

- Deploy scripts use shell export from `.env`: `export $(cat .env | xargs)`.
- If `ASTROSITE_API_KEY` differs between frontend and backend, biography calls fail with HTTP 401.

## 3) Secret ownership and alignment checklist

Before running workflows or deploying:

1. Confirm local `.env` files exist in both packages.
2. Confirm `ASTROSITE_API_KEY` is identical in:
   - `astrosite/.env`
   - deployed `GeneratePlayerBiography` function env
   - GitHub Actions repository secret `ASTROSITE_API_KEY`
3. Confirm WiseGolf/Teetime credentials are valid and not expired.
4. Confirm `GOOGLE_CREDENTIALS` parses as JSON.
5. Confirm `gcloud` account has permission to deploy to `GCLOUD_PROJECT_ID`.
