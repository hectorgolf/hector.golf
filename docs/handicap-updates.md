# How a handicap reaches this repository

_Recorded 2026-09-13._

A player's official handicap is not a number we compute. It is a number the Finnish Golf Union
computes overnight, publishes to systems like WiseGolf and Golf Gamebook, and occasionally computes
again the same day because the first attempt went wrong. Everything downstream of that — the
projected buckets, the handicap chart, the field list on an event page — inherits its timing, and
some of it inherits the failure modes too.

This document records how that works, because none of it is visible in the data. Two handicaps that
look identical may be a day apart in provenance, and nothing in the value says so.

## The chain

```
Finnish Golf Union (WHS batch)  →  WiseGolf  →  update-handicaps.ts  →  handicaps.json
```

## What the Union does

1. **The nightly batch runs at around 03:00 Finnish time**, covering rounds submitted the previous
   day. This is the normal path and it is what happens on most days.
2. **A failed nightly run is re-run during office hours.** Usually a few hours into the working day,
   so the retry lands somewhere between **09:00 and 17:00 Finnish time** — not at a fixed hour.
3. **Downstream, a handicap therefore changes once on most days and twice on some.** External
   consumers see the result of whichever batch ran most recently.

## What you cannot tell by looking

This is the part that matters, and the reason for the `observed` field.

When the morning's handicaps look unchanged, that is consistent with **all** of the following, and
the values alone do not distinguish between them:

- nothing changed, because the player submitted no rounds;
- the batch ran and was **partial**, covering some players and not others;
- the batch ran and was **partially wrong**;
- the batch **did not run at all**.

An unchanged handicap and a skipped batch look exactly the same from here. So does a wrong handicap
and a right one. The only signal that ever arrives is a *later* value replacing an earlier one,
which tells you retrospectively that the earlier one was wrong — and only if you were looking.

## What this repository does about it

### It scrapes twice a day

`update-handicaps.yml` runs at `0 3,13 * * *`, which is 03:00 and 13:00 UTC. In Finnish local terms:

| Scrape | Summer (EEST, UTC+3) | Winter (EET, UTC+2) | Relative to the Union's batches |
| --- | --- | --- | --- |
| 03:00 UTC | 06:00 | 05:00 | About three hours after the nightly run |
| 13:00 UTC | 16:00 | 15:00 | Inside the retry window, near its end |

The morning scrape is positioned to read a completed nightly batch. The afternoon scrape exists to
pick up a retry — but it only catches retries that finished before it ran. **A retry completing at
17:00 Finnish time is missed until the following morning**, by which point it is a value dated
yesterday arriving today.

### It replaces, rather than appends, within a day

`persistHandicapHistoryToDisk` looks for an existing entry with the same player and the same `date`.
If it finds one, the new value replaces it rather than becoming a second entry for that day. This is
deliberate: the afternoon value is the corrected one, and two entries for one date would make
"the player's handicap on the 13th" ambiguous.

The cost is that **the displaced morning observation is not kept.** It survives in the workflow log
and in the file's git history, and nowhere else.

### It records when each value was seen

Every entry written from 2026-09-13 onwards carries an `observed` instant:

```json
{
  "player": "lasse-k",
  "date": "2026-09-13",
  "handicap": 14.7,
  "observed": "2026-09-13T03:02:42Z"
}
```

`date` is the day the handicap belongs to. `observed` is the moment we read it. They answer different
questions and they routinely disagree.

Always UTC, always to the second, so that two of them can be compared as plain strings.

The 1393 entries that predate the field do not have one. That is honest rather than lazy — we do not
know when they were read, and a guessed timestamp would be indistinguishable from a real one.

## Reading `observed` after the fact

The case this was added for:

> The buckets for a Hector are frozen at 08:00 on the first morning, local to the event. Somebody
> looks at the site that afternoon, sees a player's current handicap, and finds that the buckets do
> not reflect it.

With `observed`, that reconstructs in one step. A Hector's buckets stop moving at 08:00 local, which
for a Finnish venue is 05:00 UTC and for Konopiště 06:00 UTC — so **the buckets are always built from
the 03:00 UTC scrape**, and the 13:00 UTC scrape is always after the freeze.

So if the entry reads:

```json
{ "player": "…", "date": "2026-09-24", "handicap": 11.2, "observed": "2026-09-24T13:01:58Z" }
```

then the Union's nightly batch had not produced that value by 06:00 Finnish time, the retry did, and
the buckets were frozen seven hours earlier against the stale number. The buckets are not wrong;
they are a correct record of what was known at 08:00. The same reasoning explains a round played on
day two under handicaps that later look off by a stroke.

Without the field, the same reconstruction means reading commit timestamps on `handicaps.json`,
which conflates when a value was *read* with when CI got round to *committing* it.

## Related

- [data-ownership.md](./data-ownership.md) — why `player.handicap` is a stopgap rather than an
  override, and why CI owns it.
- `bucketsAreOpen()` in `astrosite/src/code/data.ts` — the 08:00 freeze this document keeps referring
  to, and why an event carries a time zone.
- [architecture.md](./architecture.md) §8 — the data pipeline the scrape is part of.
