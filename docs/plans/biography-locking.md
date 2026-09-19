# Keeping a hand-edited biography

*Steps 1 and 2 shipped on 2026-09-19: `player.biographyLocked` exists, and
`update-player-biographies.ts` skips a locked player and logs who it left alone. This is what is
left. The reasoning behind the built part — why a flag rather than "fill only when empty", why a new
field rather than reinterpreting `biography` — is in this file's git history; what the code does is
described in [`current/data-ownership.md`](../current/data-ownership.md).*

## What to do

The admin sets the lock when somebody saves a biography, and an explicit **Regenerate** clears it and
re-runs generation for that one player.

## Why

Setting the lock today means typing `"biographyLocked": true` into a player's file and committing it,
which is how the person who edits biographies edits them anyway. That is what made the first two
steps worth landing alone: the protection is real with no UI at all, and the generator now says whose
text it left alone on every run.

What the admin adds is the part a person should not have to remember. Saving an edit *is* the act of
taking the field over, so the lock is not a checkbox to tick as well — one somebody forgets is
indistinguishable from no lock at all on the day the job next runs, and that day is a fortnight away
at most.

**Regenerate is what makes the lock safe to set.** Without it, locking a biography locks it for good,
because the only way back is deleting the field by hand — so the affordance quietly asks people to
choose between a paragraph they can edit and a paragraph that can ever improve again. With it, the
lock is a decision somebody can undo the same way they made it.

## Blockers

**The admin half waits on `players/` moving from the mirrored column to the owned one**, which needs
the export to cover players and the three scripts that write player files to write to Firestore
instead. Same blocker as [`bucket-locking.md`](./bucket-locking.md), and `data-ownership.md` states
the sequencing rule it follows: a collection moves into the owned column on the day the admin can
author it **and** its scheduled writer has moved to Firestore, because either alone recreates the
conflict in the other direction.

**Regenerate also needs single-player generation to be callable.** `generateBiography` is reachable
only from a whole-roster run today, and the roster is also what supplies the "do not reuse this
phrasing" context. So a single-player regeneration has to decide what to hand it — the same question
step 2 answered in the other direction, where a run seeds that context with the locked players'''
existing text so a regenerated biography cannot echo a published one.

It also has to get past `golfClubs`, the module-level IIFE in `update-player-biographies.ts`:
importing that module scrapes WiseGolf and rewrites `src/data/clubs.json` from the answer. That is
tolerable in a workflow whose job is to rewrite it and intolerable in a request handler, so whatever
the admin calls has to be something else — which is why step 2'''s testable half went to
`src/code/biographies.ts` rather than staying beside its caller.
