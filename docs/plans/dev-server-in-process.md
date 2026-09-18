# Running the dev server in-process

*Written 2026-09-16. **Phase 1 executed 2026-09-18**, in
[#174](https://github.com/hectorgolf/hector.golf/pull/174). Phase 2 is untouched, and is the only
reason this file is still here.*

## Phase 1 — done, and described elsewhere

`scripts/dev-iap.ts` calls Astro's `dev()` and no longer spawns a CLI.

The description of what that left lives in the two places that cannot drift from it:
[`architecture.md` §11](../current/architecture.md#11-local-development-and-operations) for what a
reader of the repository needs — one process, two ports, why the hop stays — and the header of
[`dev-iap.ts`](../../admin/scripts/dev-iap.ts) for why the CLI was the wrong thing to depend on.
The findings that came out of doing it are comments beside the code they explain, each with a test:
Vite moving to the next free port when the asked-for one is taken, `closeAllConnections()` not
reaching an upgraded socket, and the three lost sockets that used to end the dev session.

Repeating any of that here would be a second copy with nothing keeping it honest. What is left for
this file is the one decision phase 1 deferred.

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
