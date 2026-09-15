# Keeping a hand-edited biography

*Written 2026-09-15. **Not started.** `player.biographyLocked` is in no schema, page or script —
nothing reads it, nothing writes it. Split out of
[`data-ownership.md`](../current/data-ownership.md), which proposed it inside a document that
otherwise describes how things already are.*

[`data-ownership.md`](../current/data-ownership.md) classes `player.biography` as **authored**: owned
by whoever edits it, filled by CI only when empty, never overwritten. The code does not implement
that rule, and does not come close. This plan is what closing that gap costs.

## Why

`update-player-biographies.ts` regenerates **every** biography on every run. The loop reads nothing
about the player's existing text and writes unconditionally:

```ts
for (const player of getAllPlayers()) {
    const biography = await generateBiography(input);
    await updatePlayerData({ ...player, biography });
}
```

There is no "only if empty" guard, no diff, no skip. `update-player-club-memberships.ts` — the script
`data-ownership.md` cites as having got the authored rule right by itself — assigns `club` only when
the field is blank. The biography job does the opposite for a field the same document calls authored.

So an edited biography survives until the next run and no longer. The cron is `30 2 10,25 * *`:
02:30 UTC on the 10th and the 25th, which caps the life of a hand-written paragraph at about fifteen
days. It commits its own work, so the edit does not fail — it disappears overnight in a commit
nobody was watching, which is the failure mode `data-ownership.md` was written to prevent.

Two details make it worse than a fortnightly reset sounds:

- **The job only runs when a Hector is upcoming.** `eventToUpdateBiographiesFor()` picks the first
  upcoming event with participants and returns early when there is none. So the regeneration is not
  spread evenly through the year; it is concentrated in the run-up to a tournament — exactly when
  somebody is most likely to be correcting the text that is about to be read by everyone.
- **The regeneration is not idempotent.** Each biography is generated from the player's record *and*
  from `otherGeneratedBiographies`, the ones produced earlier in the same run, so a rerun does not
  reproduce the previous text. There is nothing to compare an edit against and nothing to restore it
  from but Git.

## Why a lock, and not "fill only when empty"

That is the rule `data-ownership.md` states for authored fields, and applied literally here it would
end biographies rather than protect them. **All 45 player files carry a biography today.** A guard
that writes only into an empty field would never write again: not when the prompt improves, not when
a player wins their first Hector, not when `player.misc` gains a hint someone added for exactly that
purpose.

The generated text is *meant* to be regenerated — it goes stale as the player's record grows, which
is why the job is on a schedule at all. What must not be regenerated is the part a person wrote. A
flag separates those two; emptiness cannot, because the field is full in both cases.

## Why a separate field rather than reinterpreting the existing one

The same 45 files are the argument. The obvious implementation — treat a non-empty `biography` as
the human's and stop touching it — reads "has a biography" as "somebody took this over", and today
that sentence is true of every player and deliberate for none of them. Nothing records which text
came from Gemini and which from a person, so the reinterpretation freezes all 45 at once, silently,
with no way to tell them apart afterwards.

A new field starts unset for everyone. "Unset" then means what it says: nobody has taken this one
over yet.

## Scope

| | |
| --- | --- |
| Schema | `packages/schemas/src/players.ts` — one optional boolean |
| Code | `astrosite/src/workflows/update-player-biographies.ts`, the loop in `updateBiographiesForEvent` |
| Admin | A player editor, which does not exist yet — see phase 3 |
| Data | 45 player files, none of which need migrating: unset is the correct starting value for all of them |

`update-handicaps` and `update-player-club-memberships` also write player files and are not changed.
Neither touches `biography`.

## Phase 1 — The field

```ts
biographyLocked: z.boolean().optional(),
```

Optional, with no `.default(false)`. A default would be written back into every player document the
first time anything round-trips them through Zod — `data-ownership.md` records exactly that happening
to fifteen events on the first admin export — and forty-five `"biographyLocked": false` lines say
nothing that their absence did not already say.

## Phase 2 — The job honours it

One filter in `updateBiographiesForEvent`, and a line in the log saying how many players were skipped
and why. Silence here would turn a lock into a suspected bug the first time someone wonders why a
biography did not refresh.

This phase is worth landing on its own, before anything can set the field from a UI. Player files are
hand- and scrape-owned today, so `"biographyLocked": true` can be typed into one in an editor and
committed — which is how the person who edits biographies today edits them anyway.

A test belongs with it: a locked player is skipped, an unlocked one is not. Nothing else in the
repository currently tests this script.

## Phase 3 — The admin writes it

Blocked, and not on effort. The admin UI can author matchplay events and nothing else:
`admin/src/lib/ownership.ts` puts `players/` in the mirrored column, refreshed from the committed
files by `npm run seed` after every scrape. A lock written into the Firestore mirror today is
overwritten within hours by the seed, which is the same class of silent revert this plan exists to
stop.

So phase 3 lands with the move of `players/` into the owned column, not before, and that move is the
larger piece of work: it needs the export to cover players and the three scripts that write player
files to write them to Firestore instead. `data-ownership.md` states the rule that sequencing
follows — a collection moves into the exported column on the day the admin can author it **and** its
scheduled writer has moved to Firestore, and either one alone recreates the conflict in the other
direction.

When it does land: saving an edited biography sets the lock. Not a checkbox the editor has to
remember — editing *is* the act of taking the field over, and a lock somebody forgot to tick is
indistinguishable from no lock at all on the 25th.

## Phase 4 — Regenerate

The lock needs a way out, or the first edit makes a biography permanent. "Regenerate biography" is an
explicit action on the player: it clears the flag and re-runs generation for that one player. That
sentence is the whole of the contract worth stating — the scheduled job never takes an edited
biography away from you; you hand it back.

Note that `generateBiography` is currently reachable only from a whole-roster run, so this phase
needs the generation of a single player's biography to be callable on its own.
