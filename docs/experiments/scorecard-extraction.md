# ExtractScorecardInformation

*An experiment. Deployed, reachable, and called by nothing. See
[`README.md`](README.md) for what that means.*

## What it does

Takes a screenshot of a golf scorecard — the kind a player takes of their phone's scorecard app at
the end of a round — and returns the scores from it as typed JSON. The intended use was the gap a
manual process leaves: a round that happened, recorded in somebody's app, and then retyped by hand
into a leaderboard sheet.

| | |
| --- | --- |
| Entry point | `ExtractScorecardInformation` |
| Source | [`src/functions/scorecard-detection/index.ts`](../../backend/backend-functions/src/functions/scorecard-detection/index.ts) |
| Prompts | [`src/lib/prompts/scorecard-detection/`](../../backend/backend-functions/src/lib/prompts/scorecard-detection/) — `v1.ts`, `v2.ts`, `v3.ts` |
| Model | `gemini-3.1-flash-lite`, `responseMimeType: application/json` |
| Auth | `Authorization: Bearer <ASTROSITE_API_KEY>` — a private function (architecture.md §10) |
| Secrets | `GOOGLE_GEMINI_API_KEY`, `ASTROSITE_API_KEY` |
| Timeout | default (60s) |

The request body is `{image, mime, version?}`, where `image` is base64 and `version` selects the
prompt generation — `1` unless told otherwise, `2` or `3` on request. Anything without both `image`
and `mime` answers `400`, echoing the request headers back minus `authorization` as a debugging
aid. Missing either secret answers `500`; a wrong bearer token answers `401`.

### Three prompt generations

The `version` parameter is the experiment's own record of itself. All three prompts live side by
side, all three still run, and the progression between them is the argument:

- **`v1`** (87 lines) — one prompt, one call. It states the TypeScript result types for every
  supported game format (Stableford, stroke play, scramble, best ball; net and scratch variants),
  names the four formats, gives two rules for deducing the format when the card does not say it,
  and asks for a matching object.
- **`v2`** (226 lines) — still one prompt and one call, but the model is taught the vocabulary
  before it is asked anything: what NET and SCR mean, how Stableford differs from stroke play, what
  "better ball" implies about team scoring. The task is then broken into numbered steps — is this a
  scorecard at all, how many holes, which row headings are present, then the values — and the model
  is asked to return a **decision log** explaining how it reached each step.
- **`v3`** (449 lines) — the steps become separate calls rather than numbered paragraphs, so that
  code can check the model between them. Stage 1 asks only for the game formats named on the card,
  the row headings, and the raw rows. Then TypeScript, not the model, cross-examines the answer: a
  null format is deduced from the headings present, and a stated format is rejected when the
  headings contradict it (Stableford without a `points` row, say).

**`v3` is unfinished.** It returns after stage 1 — game format, headings and raw rows — and the
stage that turns those rows into typed per-hole scores is the 236 lines of commented-out prompt
below that `return`. Two of its cross-examination branches are also dead: they test
`headings.includes('net') && !headings.includes('net')`, which is never true, so the two stroke-play
consistency checks do nothing. Asking for `version: 3` today gets you a well-structured reading of
the card's *shape*, and no scores.

That is the honest state of the art here, and it is worth knowing before anyone starts a fourth
attempt: the useful idea in `v3` is the cross-examination — the moment where "the answer is wrong"
became "the answer is wrong because the format was misread at stage one", which is a different and
more tractable problem than the one `v1` presented.

## Why it is not in use

**Accuracy and reliability were never good enough to trust unattended**, and the supervised version
is not obviously worth having. Scorecard screenshots vary in almost every way that matters — app,
layout, which columns are shown, whether handicaps are applied, team formats where one row is not
one player, cropping, glare on a photographed screen rather than a screenshot. Reading the numbers
is the easy part; deciding what the numbers *mean* is where it goes wrong, which is what each
prompt generation was built to attack and what the decision log was added to expose.

The economics are the second half of the objection. A wrong score that looks right is worse than no
score, so any adopted version needs a human to check it — and checking an extracted scorecard
against the screenshot takes about as long as typing it in. The value would have to come from
volume that this series does not have: a handful of events a year, each with a manageable number of
cards.

## State

- **Deployed.** `deploy-functions.yml` ships it on every push to `main` touching
  `backend/backend-functions/**`, with the same runtime identity and the same bearer-token check as
  the function that is in use.
- **Tested.** [`test/functions/scorecard-detection.test.ts`](../../backend/backend-functions/test/functions/scorecard-detection.test.ts)
  drives the handler over real HTTP through the Functions Framework, covering the auth check and
  the payload validation. It does not reach Gemini, so nothing in CI measures the accuracy that is
  the actual open question. `test/deployment` asserts the `--entry-point` still resolves.
- **No caller at all.** Not a workflow, not the site, not the Admin UI, and unlike
  [`player-avatar-generation.md`](player-avatar-generation.md) not even a shell script. The nearest
  thing is [`src/cli/cli.ts`](../../backend/backend-functions/src/cli/cli.ts), which cannot run: it
  hardcodes `samples/1.png` and no `samples/` directory exists, so it exits on its own `existsSync`
  check. The `uploadImage` branch in `genai.ts`, taken for images of 10 MB and over, reads
  `process.env.API_KEY` — a name nothing sets, and not the `GOOGLE_GEMINI_API_KEY` the rest of the
  module uses.
- **No sample corpus.** There is no committed set of scorecard screenshots with known-correct
  answers, which is the thing that would let anyone say how accurate any of the three prompts
  actually is. "Not convinced" is a recollection of trying it, not a measurement.

## What would have to be true

**To adopt it:** a corpus first. Twenty or thirty real screenshots spanning the apps and formats
this series actually plays, each with a hand-checked expected result, and a scored run of `v1` and
`v2` against it. `v3` cannot be scored on extraction until its second stage is written, but its
stage 1 can be scored on format and heading detection alone — which is worth doing first, since
that is the step `v3` was built on the premise of the other two getting wrong. A corpus turns the
open question into a number, and the number decides: either some version is good enough to put
behind a review step in the Admin UI, or it says which stage fails and gives a fourth attempt
something to aim at. Without it, the next attempt repeats this one.

A second precondition is a caller worth building. `update-leaderboards.ts` reads app.hector.golf
and Google Sheets (architecture.md §8); this would be a third source, for events managed in neither
— so the question "which events would have used it?" should be answerable before anyone writes it.

**To delete it:** deciding that scorecard entry stays manual. That is the function, the three
prompt files, `genai.ts`, `test/functions/scorecard-detection.test.ts`, the broken
[`src/cli/cli.ts`](../../backend/backend-functions/src/cli/cli.ts), the deploy matrix entry, the
`extractscorecardinformation` member of `cloud_run.tf`'s `allUsers` set, and this file. It is the
cleaner of the two deletions in this directory: nothing else in the repository depends on any of
it.
