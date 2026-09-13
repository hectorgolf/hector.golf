# Tests for the Cloud Functions

Three suites, because there are three different questions worth asking about a Cloud
Function and they cost wildly different amounts to answer.

```bash
npm test                 # all three
npm run test:unit        # ~0.1s
npm run test:functions   # ~0.3s
npm run test:deployment  # ~2s, builds dist/ first
npm run test:watch       # unit + functions, on change
npm run typecheck        # tsc over the tests, which the deployable build excludes
```

## `test/unit` — the ordinary kind

Import a module, call a function, assert. No HTTP, no framework, no build. This is where
the fiddly logic belongs, because here one rule costs one line: the avatar payload
validator has eleven rejection rules and eleven assertions, where covering the same
ground through the HTTP interface would be eleven requests that can only ever see the
combined verdict on both image fields at once.

Most of what is worth testing this way already lives in `src/lib/`, which the functions
import and tests can import just as easily. When something worth testing is a helper
inside a function module — `validateAvatarImagePayload` is the example — exporting it is
enough. It does not widen the deployed surface: `gcloud` resolves `--entry-point` by
name against the package's `main`, so an extra named export changes nothing about what
is deployed or callable.

## `test/functions` — the function over real HTTP

Drives the exported handler through the Functions Framework's own Express server on a
throwaway port (`test/support/http-function.ts`), so `request.header()`, `request.query`,
`request.headersDistinct`, the body parsers, the status codes and the response headers
are the real ones. A hand-rolled fake request would only implement the three methods the
handler happens to call today, and would keep passing after someone reached for a fourth.

The modules are imported from `src/`, so there is no build step and watch mode works.

Everything past the edge of our own code is mocked at our own module boundary rather
than inside somebody's SDK:

```ts
const generatePlayerAvatar = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/prompts/avatar/genai", () => ({ generatePlayerAvatar }));
```

That keeps the test about the HTTP contract — what a caller must send and what they get
back — and has the side benefit that `@google/generative-ai` is never loaded at all.

One thing to know about the helper: it captures `globalThis.fetch` when it is imported,
before any test can stub it. `TournamentLeaderboard` is tested by replacing the global
`fetch` with a stub for app.hector.golf, and without that precaution the test client's
own call to the function under test would be answered by the very stub it installed.

## `test/deployment` — will it actually work when deployed?

The other two suites cannot answer that. A deploy has its own ways to fail:

- `--entry-point=X` names an export that got renamed, or was never re-exported from
  `src/functions/index.ts`
- `package.json`'s `main` points somewhere `tsc` does not write
- the compiled JavaScript throws on load, because something it needs at runtime sits in
  `devDependencies` and Cloud Functions prunes those
- a `--source=dist/...` path in a `start:`/`dev:` script drifted from the layout

So this suite compiles `dist/` and then starts the real Functions Framework CLI against
it as a separate process, once per `--entry-point` the deploy scripts name — the same
binary, and the same entry-point resolution, that Google's Node.js runtime uses. If it
serves here, that artifact serves there.

The entry points are read out of `package.json` rather than listed again here, so a new
function is covered as soon as it has a deploy script. Each one gets a smoke test (it
loads, it serves) plus, where one is written, a request answered from the handler's own
guard clauses — a 401 without an API key, a 400 without an event id. Those are chosen so
that nothing ever reaches Gemini or app.hector.golf.

Two deliberate details:

- The functions run with a **bare environment** (`PATH` and placeholder keys, nothing
  else). Inheriting the developer's shell would let a real `GOOGLE_GEMINI_API_KEY` decide
  whether a test passes, and these have to behave the same on a laptop and on a CI runner
  that has never heard of Gemini.
- There is a test that starts a **deliberately wrong** entry point and expects the helper
  to report the failure. Without it, a suite that only ever asserts "it served" could
  quietly stop being able to fail.

Nothing here touches the network, GCP, or `gcloud`.
