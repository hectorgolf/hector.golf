# Running the dev server in-process

*Written 2026-09-16. **Not started.** `scripts/dev-iap.ts` still spawns `astro dev` as a child
process. This is the alternative that was considered, and not taken, while fixing the daemonising
bug described below.*

`scripts/dev-iap.ts` runs the dev server by spawning Astro's CLI and proxying to it. Astro also
ships a programmatic API — `dev()`, exported from the `astro` package — which starts the same
server inside the calling process and hands back an object with `stop()` on it. This plan is what
switching to it would cost and buy.

## Why this came up

`npm run dev:iap` broke, and the shape of the breakage is the argument.

Astro 7.3 daemonises the dev server **on its own**, without `--background`, when `am-i-vibing`
recognises the surrounding process as an AI coding agent. From `astro/dist/cli/dev/index.js`:

```js
const agentDetected = !process.env.ASTRO_DEV_BACKGROUND && isRunByAgent()
const wantsBackground = !!flags.background || agentDetected
```

The stand-in proxies to a server it *supervises*: it waits for the port and it dies when the server
dies. A server that daemonises is no longer the process it spawned, so the child exited immediately,
the exit handler fired, and the whole thing was over about a second after it started — having
printed `astro dev exited (0)`, which is exactly what happened and says nothing about why.

That was fixed by setting `ASTRO_DEV_BACKGROUND` and passing `--ignore-lock`, and the fix is sound.
But note what it is: **two undocumented levers, pulled to stop somebody else's CLI from making a
decision this script cannot live with.** The variable's name reads backwards for the purpose, the
behaviour is pinned by a test that reads Astro's compiled source, and neither is promised to survive
an upgrade.

The class of problem is the point. Spawning a CLI means inheriting every decision that CLI makes
about process lifetime, and those decisions are not part of any API. `dev()` is a function that
returns a server; it makes no decisions about processes at all.

## What it would look like

`dev()` takes an `AstroInlineConfig` and resolves `astro.config.mjs` the way the CLI does. Its
return type is the whole of the surface this would use:

```ts
export interface DevServer {
    address: AddressInfo
    resolvedUrls: vite.ResolvedServerUrls
    handle: (req: http.IncomingMessage, res: http.ServerResponse) => void
    watcher: vite.FSWatcher
    stop(): Promise<void>
}
```

So the spawn, the binary lookup and the port poll collapse into one call:

```ts
const astro = await dev({ root: adminDir, server: { port: appPort, host: '127.0.0.1' } })
```

and `stop()` becomes the shutdown path in place of `astro.kill('SIGTERM')`.

## What it deletes

| | |
| --- | --- |
| `astroBinary()` | The two-candidate search for `node_modules/.bin/astro` |
| `waitForPort()` | `dev()` resolves when the server is listening; there is nothing to race |
| `FOREGROUND_FLAGS`, `foregroundEnvironment()` | Both exist only to talk the CLI out of daemonising |
| `exitMessage()` | There is no child exit to interpret |
| The `astro dev exited` handler | A failure to start is a rejected promise, thrown where it happened |
| `ChildProcess`, `existsSync`, `spawn` imports | With them |

Roughly 60 lines, and — more to the point — every line in the file that is about *process
management* rather than about standing in for IAP. What is left is the part the file is named for.

## What it does not solve, and the two things to check first

**The HMR websocket still needs the port.** `DevServer` exposes `handle` for requests and nothing
for `upgrade`. Vite's hot-reload socket is attached to the server's own HTTP listener, which is why
`dev-iap.ts` forwards `upgrade` by hand today. So the honest version of this plan keeps the proxy
and only removes the *spawn*: `dev()` still listens on `appPort`, and the stand-in still proxies to
`server.address.port` exactly as it does now.

Calling `handle(req, res)` directly and dropping the proxy altogether is a further step, and a
separate decision — it would need the HMR client pointed at Astro's own port through
`vite.server.hmr`, and it trades a real HTTP hop for a function call. That hop is worth something:
production is IAP talking to Cloud Run over HTTP, and a stand-in that serialises headers the same
way is faithful in a way an in-process call is not. Do not fold that change into this one.

**The API is marked experimental.** Astro's own JSDoc says so:

> `@experimental The JavaScript API is experimental`

Which is a real cost and should not be waved away — but weigh it against what actually happened.
The CLI is the stable, documented interface, and it is the CLI that changed its process model
under this script without notice. "Experimental function" and "stable command whose lifecycle
semantics are undocumented" are not as far apart as the labels suggest.

**One process, one failure.** The stand-in would *be* the dev server rather than supervise one, so a
crash in the stand-in takes the server with it. That is already true in the direction that matters
(the stand-in exits when the server does), and it removes the orphan case — today a hard kill of the
stand-in can leave a dev server holding the port, which is the exact hazard `astroBinary()`'s comment
was written about.

## Phases

### Phase 1 — Swap the spawn

Replace `spawn` + `waitForPort` with `await dev(...)`, and `astro.kill` with `server.stop()`. Keep
the proxy, keep `APP_PORT`, keep the `upgrade` forwarding. Delete `FOREGROUND_FLAGS`,
`foregroundEnvironment`, `exitMessage` and the tests that pin Astro's compiled source, since the
mechanism they defend stops being reachable.

This is the whole of the benefit that motivated the plan. It is worth landing alone.

### Phase 2 — Decide about `handle()`

Only once phase 1 has been lived with. The question is whether the proxy is carrying its weight, and
the answer depends on whether anything has ever been debugged through the fact that it is a real
HTTP hop. If nothing has, `handle()` deletes the second port; if something has, the hop stays and
this phase is closed rather than done.

## Why it was not done now

The fix in flight was a bug fix for a script that was failing for people today, and this is a
rewrite of how that script runs the server. Landing them together would have meant reviewing both
at once, with the rewrite's risk attached to the fix's urgency.

There is also a sequencing argument. The `ASTRO_DEV_BACKGROUND` fix is pinned by a test that reads
Astro's compiled source — so if Astro changes the mechanism, CI says so, and *that* is the moment
this plan becomes cheap to justify rather than merely tidy.
