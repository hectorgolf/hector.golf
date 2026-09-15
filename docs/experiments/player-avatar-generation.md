# GeneratePlayerAvatar

*An experiment. Deployed, reachable, and called by nothing. See
[`README.md`](README.md) for what that means.*

## What it does

Takes two images and returns one. Image 1 is a real photograph of a player and is the authoritative
source for identity — face shape, skin tone, eyes, hair, facial hair, glasses. Image 2 is a style
reference **only**: line weight, shading, saturation, framing. The system instruction says so at
length, because the failure it guards against is the model borrowing the style reference's face
along with its style.

The output is a cartoon headshot: plain white polo with no logo, flat `#cccccc` background, 9:16
portrait, PNG, returned base64-encoded as `{avatar, mimeType}`.

| | |
| --- | --- |
| Entry point | `GeneratePlayerAvatar` |
| Source | [`src/functions/generate-player-avatar/index.ts`](../../backend/backend-functions/src/functions/generate-player-avatar/index.ts) |
| Prompt | [`src/lib/prompts/avatar/genai.ts`](../../backend/backend-functions/src/lib/prompts/avatar/genai.ts) |
| Model | `gemini-3.1-flash-lite-image`, `responseModalities: ["IMAGE", "TEXT"]` |
| Auth | `Authorization: Bearer <ASTROSITE_API_KEY>` — a private function (architecture.md §10) |
| Secrets | `GOOGLE_GEMINI_API_KEY`, `ASTROSITE_API_KEY` |
| Timeout | 540s |

Both image fields accept four shapes — a bare base64 string, a data URL, `{data}` / `{base64}`, or
`{inlineData: {data, mimeType}}` — and an invalid one answers `400` with a `details` array naming
each validation failure. `backend/README.md` has request and response examples for all of them.

## Why it is not in use

**The output is not uniform enough across arbitrary source photos.** That is the whole objection,
and it is about the inputs rather than the model: player photographs arrive as whatever the player
had — different lighting, crops, angles, resolutions, group shots — and the generated avatars
inherit that variance. A row of profile pictures that do not look like a set is worse than a row of
initials, because the inconsistency reads as a bug rather than as a style.

Nothing stops a single generated avatar from being good. What has not been demonstrated is
thirty-four of them being good *together*, which is the only form in which the site would use
them.

## State

- **Deployed.** `deploy-functions.yml` ships it on every push to `main` touching
  `backend/backend-functions/**`, with the same runtime identity and the same deploy path as the
  two functions that are in use.
- **Tested.** [`test/functions/generate-player-avatar.test.ts`](../../backend/backend-functions/test/functions/generate-player-avatar.test.ts)
  drives the handler over real HTTP through the Functions Framework, and
  `test/unit/avatar-payload-validation.test.ts` covers the four accepted image shapes. Neither
  reaches Gemini. `test/deployment` asserts the `--entry-point` the deploy names still resolves.
- **No automated caller.** Not the Astro site, not a workflow, not the Admin UI. The only caller in
  the repository is `generate-avatars.sh`, run by hand, which loops over
  `astrosite/src/data/players/images/originals/*.jpeg` (40 photographs), skips any that already has
  an avatar, and writes PNGs into a sibling `avatars/` directory through the CLI in
  [`src/cli/generate-player-avatar.ts`](../../backend/backend-functions/src/cli/generate-player-avatar.ts).
- **Its output was committed once, and taken back out.** Thirty-four generated PNGs and the
  `sample.png` used as their style reference lived under
  `astrosite/src/data/players/images/avatars/` until commit `8c6d8d0`, "Remove the avatars from
  Git", on 2026-09-10 — 55 MB across 35 files, roughly 1.5 MB each. No player JSON set the optional
  `image` field that [`packages/schemas/src/players.ts`](../../packages/schemas/src/players.ts)
  defines for them, and no page read one. Only `originals/` is committed today.
- **And so `generate-avatars.sh` no longer runs.** It passes
  `$IMAGE_DIR/avatars/sample.png` as the style reference, and that file went with the rest in
  `8c6d8d0`. Anyone reviving this has to supply a style reference before the script does anything —
  which is not a hardship, but it is not a script you can just run.

Leaving it deployed costs a job in the deploy matrix. The function scales to zero and an endpoint
nobody calls bills nothing.

## What would have to be true

**To adopt it:** a batch of twenty or so avatars, generated from the real spread of player
photographs rather than from chosen ones, that a person would accept as a set on a player-listing
page. Uniformity is the acceptance test; likeness is not in question. Getting there most plausibly
means constraining the input — a photograph brief, or a pre-pass that crops and normalises before
the model sees anything — rather than a longer prompt, since the prompt already states the
constraints that matter and the variance is upstream of it.

**To delete it:** deciding the site does not want per-player pictures at all. That deletion is
larger than this function — the 40 photographs under
`astrosite/src/data/players/images/originals/`, the CLI, `generate-avatars.sh`, the
`GeneratePlayerAvatar` entry in the `deploy-functions.yml` matrix and in `cloud_run.tf`'s
`allUsers` set, the optional `image` field in `packages/schemas/src/players.ts`, and this file. The
2026-09-10 removal of the generated PNGs already did the expensive half of it.
