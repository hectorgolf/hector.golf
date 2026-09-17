# How a handicap reaches this repository

*Recorded 2026-09-13.*

A player's official handicap is not a number we compute. It is a number the Finnish Golf Union
computes overnight, publishes to systems like WiseGolf and Golf Gamebook, and occasionally computes
again the same day because the first attempt went wrong. Everything downstream of that — the
projected buckets, the handicap chart, the field list on an event page — inherits its timing, and
some of it inherits the failure modes too.

This document records how that works, because none of it is visible in the data. Two handicaps that
look identical may be a day apart in provenance, and nothing in the value says so.

## The chain

```text
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

### It scrapes every two hours through the morning, and once after lunch

Cloud Scheduler starts the updates — `terraform/scheduler.tf` — and since 2026-09-16 it is the only
thing that does. The workflows used to keep their own `schedule:` crons as a backstop; those were
delivered hours late, which made them a second clock that was always wrong, and they were deleted.
The trade is that a Cloud Scheduler or admin outage now means no updates at all, silently, where it
previously meant late ones.

| Ticks | UTC | Summer (EEST) | Winter (EET) |
| --- | --- | --- | --- |
| Every two hours | 03:00, 05:00, 07:00 | 06:00, 08:00, 10:00 | 05:00, 07:00, 09:00 |
| Once | 12:00 | 15:00 | 14:00 |

**The morning is a window rather than a moment because the thing it waits for does not keep to a
time.** On 2026-09-14 the Union's numbers landed between 06:00 and 08:22 Finnish. The scrape that
day ran at 06:00:36 — inside that window and past it by seconds — so all 37 players read as
unchanged and the site carried yesterday's handicaps until the afternoon. With a window of ticks the
worst case is two hours stale rather than most of a day.

The window is sized to the golf, not to the Union: we play in Europe and a realistic early tee time
is 04:00 to 07:00 UTC. A handicap arriving after the first tee shot is too late to be the one anyone
played off. The ticks cover that whole range. The last one before a Hector's buckets freeze — 08:00
local, so 05:00 UTC in Finland and 06:00 at Konopiště — is therefore 03:00 and 05:00 respectively.
Konopiště is unchanged from when this was hourly; a Finnish venue lost its 04:00 tick, so a handicap
published between 03:00 and 05:00 UTC now misses the buckets where before it had a second chance.

That is the accepted cost, on the same grounds the hourly version accepted its own smaller one: the
buckets are projected until the morning of the event, and a value arriving that late is one the Union
itself published late. What bought it is halving the load on WiseGolf — see `terraform/scheduler.tf`,
where the cadence and the reason for it live together.

The afternoon tick is a single one, for a retry that finished during office hours. By then the round
is under way and the handicaps are whatever they were at the first tee, so it is about the site
being right rather than about anyone playing off it. **A retry completing after 15:00 Finnish time
is still missed until the next morning.**

None of this costs anything. Cloud Scheduler's free tier is three *jobs* per billing account, billed
per job per month rather than per execution, so four firings cost what one does — and this is still
two jobs, as it was when it was two ticks.

### It keeps every reading, including two in one day

`handicaps.json` is a **log of observations**, not a table of days. A handicap read twice on the
13th is two entries dated the 13th:

```json
{ "player": "lasse-k", "date": "2026-09-13", "handicap": 14.7, "observed": "2026-09-13T03:02:42Z" },
{ "player": "lasse-k", "date": "2026-09-13", "handicap": 14.5, "observed": "2026-09-13T13:10:06Z" }
```

An earlier version replaced the morning entry instead, so that "the handicap on the 13th" had one
answer. That kept the file tidy and threw away the only evidence of what a page had been showing
before the retry landed — which is the question this whole document exists to answer.

Nothing is written when a reading matches what is already on record, so an unchanged handicap does
not add a row. Only *changes* accumulate.

### Days are a view, not the shape of the file

Almost everything that reads the history wants days rather than readings: what the handicap was on a
date, what it was the day before, twenty days of it to draw a chart. `latestPerDay()` in
`packages/schemas/src/handicaps.ts` collapses the log to the last reading of each day, and the two
places that read the history both go through it:

| Reader | What it would get wrong without the collapse |
| --- | --- |
| `getPlayerHandicapFromHistory` (the scrape) | An offset of `-1` means "the day before". Over a raw log it would mean "this morning", so the bucketing sort would read a day's trend off two readings an hour apart |
| `getPlayerHandicapHistoryById` (the site) | The chart plots `{x: date, y: handicap}` and takes the last twenty. Over a raw log it would plot two points at the same x, and "twenty" would stop meaning twenty days |

`observationsOn(history, player, date)` is the other direction, for when you want the readings
themselves.

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

Entries that predate the field do not have one. That is honest rather than lazy — we do not know
when they were read, and a guessed timestamp would be indistinguishable from a real one. Where one
of those shares a day with a newer reading, the stamped one is treated as the later of the two.

### It records that it looked, even when nothing changed

`handicaps.json` only grows when a handicap moves. That leaves the commonest question unanswerable:
a player whose handicap has not changed since August has no recent entry, and nothing in this
repository says whether we last asked this morning or in the spring.

`src/data/handicap-checks.json` is the other half. `update-handicaps.ts` appends one entry per run,
whatever the run found:

```json
{
  "at": "2026-09-14T03:02:42Z",
  "checked": 44,
  "skipped": ["ricke-b"]
}
```

`skipped` names the players no source answered for — either they have no club to look up, or every
source failed on them. The two are not told apart because nothing acts on the difference: neither
was checked. Keeping the exceptions rather than the roster is what holds the file to a line or two
per sweep.

An entry carrying `"approximate": true` was **reconstructed**, not recorded. The log began on
2026-09-14, and HECTOR2025 — played the previous September — had nothing to say about when its
handicaps were last checked. Six entries were rebuilt for that week from what survives:

| Evidence | Entries |
| --- | --- |
| Data commits touching `handicaps.json`, whose committer date is a moment a sweep demonstrably ran at or shortly before | 26, 27, 28, 29 September and 1 October 2025 |
| The `0 3,13` cron then in force, for the first morning, which left no commit because nobody's handicap moved that day | 25 September 2025, 03:24Z |

`checked` and `skipped` come from the roster as committed at the time: 44 players, of whom four had
no club and so could not have been asked about. A player the sources merely failed on that day
leaves no trace and is counted as checked.

What a reconstruction cannot recover is every **quiet** sweep, because only sweeps that changed a
handicap left a commit. The result is therefore a lower bound: the real answer is never older than
what is published, and is usually newer. That is the direction `handicaps_checked` already guarantees
in, which is what makes a lower bound usable rather than misleading — and the `approximate` flag is
what keeps it from being mistaken for a recording. Entries a real sweep wrote never carry the flag,
so the two stay tellable apart for good.

A sweep that answered for **nobody** is not recorded. Its entry would be the whole roster, and
writing it would commit and deploy the site over a run that learned nothing; a total outage is a
workflow-log problem, not a data-file one.

Nothing else is dropped: the log is appended to and never pruned, like `handicaps.json`. A Hector's
buckets are part of its record and are kept for good, so what explains them has to be kept for good
too — the 2026 split is still on the site in 2036, and "the handicaps behind it were last checked at
03:01 that morning" has to still be answerable then. It costs about 57KB a year.

This is what `/events/hector/:id/handicaps.json` publishes as each basis's `observed` — a player's
`bucketing.observed` and `playing.observed`, the same question asked at the two ends of an event —
and as `handicaps_checked` for the field as a whole. Together with the handicap beside it, that is
what answers "my eBirdie shows something else": the number we hold, and the moment we last asked
about it.

## Reading `observed` after the fact

The case this was added for:

> The buckets for a Hector are frozen at 08:00 on the first morning, local to the event. Somebody
> looks at the site that afternoon, sees a player's current handicap, and finds that the buckets do
> not reflect it.

With `observed`, that reconstructs in one step, and the reconstruction is a comparison rather than an
assumption. A Hector's buckets stop moving at 08:00 local — 05:00 UTC for a Finnish venue, 06:00 UTC
for Konopiště — so **which readings the buckets could have used is whichever ticks fell before that
time**, and `observed` says which ones those were. A busier tick schedule means the answer is no longer
"the morning scrape" but a specific instant you can read off the entry.

So if `observationsOn(history, "…", "2026-09-24")` gives:

```json
{ "player": "…", "date": "2026-09-24", "handicap": 11.8, "observed": "2026-09-24T05:00:41Z" },
{ "player": "…", "date": "2026-09-24", "handicap": 11.2, "observed": "2026-09-24T12:00:58Z" }
```

then for Konopiště, whose buckets froze at 06:00 UTC, the page is showing 11.2, the buckets were
built from 11.8 — the 05:00 tick, the last before the freeze — and the second reading landed seven
hours after they stopped moving. The buckets are not wrong; they are a correct record of what was
known at 08:00 — and the log says what that was, rather than leaving it to be inferred.

That last part is why both readings are kept. A single entry carrying only the later `observed`
proves a value arrived after the freeze but not which value the freeze used; recovering that would
mean reading `handicaps.json` out of git at the right commit. The same reasoning explains a round
played on day two under handicaps that later look off by a stroke.

Without `observed` at all, even the timing has to come from commit timestamps, which conflate when a
value was *read* with when CI got round to *committing* it.

## Related

- [data-ownership.md](./data-ownership.md) — why `player.handicap` is a stopgap rather than an
  override, and why CI owns it.
- `bucketsAreOpen()` in `astrosite/src/code/data.ts` — the 08:00 freeze this document keeps referring
  to, and why an event carries a time zone.
- [architecture.md](./architecture.md) §8 — the data pipeline the scrape is part of.
