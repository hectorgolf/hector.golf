# Keeping a hand-edited biography

*Not started. `player.biographyLocked` is in no schema, page or script. Split out of
[`data-ownership.md`](../current/data-ownership.md), which classes `player.biography` as authored
while the code does the opposite; the longer argument is in this file's git history.*

## What to do

1. `biographyLocked: z.boolean().optional()` in `packages/schemas/src/players.ts` — optional and
   undefaulted, or the first Zod round-trip writes `false` into all 45 player files.
2. `update-player-biographies.ts` skips a locked player, and logs how many it skipped and why.
   Silence turns a lock into a suspected bug the first time a biography does not refresh.
3. The admin sets the lock when somebody saves an edit, and an explicit **Regenerate** clears it and
   re-runs generation for that one player.

Saving is the act of taking the field over, so the lock is not a checkbox to remember — one somebody
forgets is indistinguishable from no lock at all on the day the job next runs.

## Why

`update-player-biographies.ts` regenerates **every** biography on every run, with no "only if empty"
guard, no diff and no skip. It runs about every fifteen days — `cadence: { every: '15d' }` in
[`workflows.ts`](../../admin/src/lib/workflows.ts), dispatched by the tick rather than by a cron of
its own — so a hand-written paragraph lives a fortnight and then disappears in a commit nobody was
watching, which is the silent revert `data-ownership.md` exists to prevent. The run on 2026-09-10
rewrote all 45.

Generation is also not idempotent — each biography is generated partly from the others produced in
the same run — so a rerun does not reproduce the previous text and there is nothing to restore an
edit from but git.

**The schedule has a second gate, and it is the one worth knowing.** The job writes nothing unless a
Hector is upcoming, and `isUpcomingEvent` compares start dates, so it stops writing the day after an
event begins and does not write again until the next one is committed. It keeps *running* throughout
— four fortnightly runs between 2026-01-25 and 2026-03-10 all went green and all committed nothing,
and the next one to rewrite anything was on 2026-03-21, the day `HECTOR2026.json` was added. Green is
therefore not evidence that a biography survived, which is worth knowing before reading the run log
for reassurance. Rewrites also do not cluster around an event: they run fortnightly through the
months before it and stop when it arrives.

That makes now the cheap moment to land this. The last run was 2026-09-10, the next is due
2026-09-25, and HECTOR2026 starts on the 24th — so nothing is due to be rewritten, and nothing will
be until a HECTOR2027 exists. The lock wants to be in before that first run of the next season,
because it is the one that takes back every edit made in the quiet.

**A flag rather than "fill only when empty".** That is the rule `data-ownership.md` states for
authored fields, and applied literally it would end biographies rather than protect them: all 45
players have one, so a write-only-when-empty guard would never write again — not for a better prompt,
not for a player's first Hector win, not for a hint somebody added to `player.misc` for exactly that
purpose. The generated text is *meant* to be regenerated; what must not be is the part a person
wrote, and emptiness cannot tell those apart when the field is full in both cases.

**A new field rather than reinterpreting the existing one**, for the same reason. Reading "has a
biography" as "somebody took this over" is true of all 45 today and deliberate for none of them, so
it would freeze every one of them at once, silently, with nothing left to tell them apart afterwards.
Unset starts out meaning what it says.

## Blockers

**None for the first two steps.** Player files are hand- and scrape-owned, so
`"biographyLocked": true` can be typed into one and committed — which is how the person who edits
biographies edits them anyway. That half is worth landing on its own, with the test that a locked
player is skipped and an unlocked one is not; nothing in the repository currently tests this script.

**The admin half waits on `players/` moving from the mirrored column to the owned one**, which needs
the export to cover players and the three scripts that write player files to write to Firestore
instead. Same blocker as [`bucket-locking.md`](./bucket-locking.md), and `data-ownership.md` states
the sequencing rule it follows: a collection moves into the owned column on the day the admin can
author it **and** its scheduled writer has moved to Firestore, because either alone recreates the
conflict in the other direction.

**Regenerate also needs single-player generation to be callable.** `generateBiography` is reachable
only from a whole-roster run today.
