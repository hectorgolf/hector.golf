# Running the dev server in-process

*Written 2026-09-16. **Phase 1 executed 2026-09-18.** `scripts/dev-iap.ts` calls Astro's `dev()`
and no longer spawns a CLI. Phase 2 — dropping the proxy in favour of `handle()` — is untouched and
is the only reason this file is still here.*

## Phase 1, as it turned out

`dev()` is exported from the `astro` package, takes an `AstroInlineConfig`, resolves
`astro.config.mjs` the way the CLI does, and resolves once the server is listening:

```ts
const astro = await dev({ root: adminDir, server: { port: appPort, host: '127.0.0.1' } })
```

The proxy stayed, `APP_PORT` stayed, the `upgrade` forwarding stayed. What went was every line in
the file about *process management*: `astroBinary()`, `waitForPort()`, `FOREGROUND_FLAGS`,
`foregroundEnvironment()`, `exitMessage()`, the `astro dev exited` handler, and the tests that
pinned Astro's compiled source. Sixty-odd lines, and the whole of the reason it was worth doing.

Three things the plan did not predict:

- **The proxy forwards to `astro.address.port`, not to `APP_PORT`.** With `strictPort` off, Vite
  moves to the next free port when the requested one is taken. The spawned version proxied to the
  port it had *asked* for and broke when Vite moved; asking the returned server where it ended up
  is strictly better, and costs nothing.
- **`server.closeAllConnections()` does not reach an upgraded socket.** Node stops counting one as
  the server's the moment `upgrade` is emitted, so `close()` waits for the hot-reload websocket
  forever. Shutdown therefore hangs off `astro.stop()` rather than off the stand-in's `close()`
  callback, on a three-second deadline — and the test suite tracks its own sockets for the same
  reason.
- **Three ways a lost socket ended the session.** The proxy had no answer for a dev server that
  went away mid-response (the error arrives on the response, not the request, and `pipe` does not
  carry it across, so the browser sat out a content-length that never arrived), and none for an
  RST on an upgraded socket from either end (Node hands those over without its own `error`
  listener, so it was an uncaught exception). All three predate this change and all three were
  survivable while the dev server was a child: the worst of it was an orphan. It is this process
  now, so each one ends the dev session, and each now has a guard and a test that fails without it.

What it bought, measured rather than argued: `npm run dev:iap` starts from an agent again without
`ASTRO_DEV_BACKGROUND`; Ctrl-C exits in about 120ms with a websocket and a keep-alive open, both
ports released; and `kill -9` leaves no dev server holding a port, because there is no longer a
second process to orphan.

The API is still marked `@experimental`. That is the cost, and it is the one to watch on an Astro
upgrade. It is worth restating why it was accepted: the CLI is the stable, documented interface,
and it is the CLI that changed its process model under this script without notice.

## Phase 2 — decide about `handle()`

Not done, and deliberately not yet.

`DevServer` exposes `handle(req, res)` for requests and nothing for `upgrade`. Vite's hot-reload
socket is attached to the dev server's own HTTP listener, which is why the stand-in still forwards
`upgrade` by hand and why the second port survived phase 1. Calling `handle()` and dropping the
proxy would delete that port, but it needs the HMR client pointed at Astro's own port through
`vite.server.hmr`, and it trades a real HTTP hop for a function call.

That hop is worth something: production is IAP talking to Cloud Run over HTTP, and a stand-in that
serialises headers the same way is faithful in a way an in-process call is not. The question is
whether anything has ever been debugged through the fact that it is a real hop — a header seen in
`tcpdump`, a `curl` aimed at `APP_PORT` directly, a 502 that said which half failed. If nothing
has, `handle()` deletes the second port. If something has, the hop stays and this phase is closed
rather than done, and this file goes with it.
