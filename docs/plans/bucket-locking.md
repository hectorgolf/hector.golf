# Locking a Hector's buckets early

*Written 2026-09-15. **Phases 1-3 executed 2026-09-18**; phase 4 is blocked on the admin being able
to author Hector events at all. `event.bucketsLocked` is in the schema, the handicap job honours it,
and `/events/hector/:id/handicaps.json` publishes it as `buckets_locked`. Setting it means editing
the event's JSON file and committing it, which is how Hector events are edited today. Split out of
[`data-ownership.md`](../current/data-ownership.md), which proposed it inside a document that
otherwise describes how things already are, and which now describes the field rather than proposing
it. What the code does is described in
[`current/architecture.md`](../current/architecture.md#published-data); what is left here is the
part that has not happened.*

`event.buckets` is derived. `update-handicaps.ts` recomputes it on every scheduled tick — 03:00,
05:00 and 07:00 UTC, and once at 12:00 — for every Hector that has participants and whose buckets are
still open, by sorting the field by handicap and cutting it in half. `bucketsLocked` is the one thing
that stops it doing so.

Two notes on that schedule, because both bear on how much this field buys. It used to be hourly
across the morning and was halved on 2026-09-16 to pay for the handicaps job sweeping WiseGolf
alongside the workflow — which means a Finnish venue lost the 04:00 tick before its 05:00 freeze, so
a handicap published between 03:00 and 05:00 UTC now misses the buckets where it previously had a
second chance. See `terraform/scheduler.tf`. And the recomputation itself is one of the four outputs
of `update-handicaps.ts` that [`handicaps-to-firestore.md`](./handicaps-to-firestore.md) has to find
a home for before it can delete that workflow; whichever plan lands first, this field would attach to
whatever ends up recomputing the split.

## Why

The buckets decide the Draft after round one, where each player picks a partner from the opposite
bucket. They are computed from handicaps, and handicaps move: WiseGolf's batch can land at almost
any hour, so a player can change bucket between two scheduled runs without anybody having asked for
it.

That statement used to be the whole case for this field, and it is not any more. `bucketsAreOpen()`
now closes the buckets at 08:00 on the first morning, local to the event, and `update-handicaps`
filters on it — so the case the field was mostly meant to cover, buckets moving underneath a Draft
that is about to use them, is already covered by the clock. What is left is the part a clock cannot
express: locking the split **earlier** than the first morning. Two situations want that.

**The split has been announced.** Buckets are published on the event page before the event, as
"Projected Buckets", and at some point somebody stops calling them projected — in a message, in a
group chat, in a conversation at the previous round. From that moment the freeze at 08:00 on the
first morning is days too late to be any protection: a scrape the following night reshuffles the
halves, the page quietly disagrees with what the players were told, and the first anyone knows of it
is on the tee. Until this field there was no way to say "this one is settled now"; the only settling
mechanism was a date.

**The split was decided by hand.** The automatic rule is handicap order, halved at `ceil(n/2)`. It is
a good rule and it is not always the right answer: a late replacement whose federation record has not
caught up with how they actually play, an odd number where the cut falls between two players on the
same handicap, a returning player whose stored figure is a stopgap rather than a reading. Overriding
that needs two things, and this field is only one of them — the other is a way for a human to write
`event.buckets` at all, which the admin cannot do either. The lock is what makes a hand-made split
survive the next scrape; without it, a hand-made split lasts until 13:00.

The first situation stands on its own. The second does not, and should not be used to justify this
plan by itself.

## Why a separate field

The obvious implementation is to let a human write `event.buckets` and have CI stop touching an event
that has them. Three of the thirteen Hector events carry buckets today, every one of them written by
CI, and nothing in the file records which. Reading "has buckets" as "a human owns these" freezes all
three, and worse, freezes every future event the moment CI first writes one — the field would become
self-locking on its own first write, which is the exact opposite of what it is for.

A new, empty field has no history to misread. `bucketsLocked` starts unset for everyone, so "unset"
unambiguously means "nobody has taken this over".

## What "locked" stops, and what it does not

Worth settling, because the word promises more than the field delivers.

| | Affected by the lock? |
| --- | --- |
| Which players are in which bucket | Yes — this is the whole of the feature |
| The handicaps shown beside their names | **No.** `populateUpdatedHandicaps()` in `events.ts` refreshes those from the live history at build time, for any event that is not past |

That asymmetry is right rather than an oversight. The split is the thing that was announced; the
numbers beside it are information about the players, and a locked split showing yesterday's handicaps
would be a second, staler copy of something the site already publishes correctly. But "locked" reads
as "nothing here changes any more", so it wants saying out loud in whatever the admin UI shows.

## Scope

| | |
| --- | --- |
| Schema | `packages/schemas/src/events.ts`, `hectorEventSchema` — one optional boolean |
| Code | `updateBucketsForUpcomingEvents` in `astrosite/src/workflows/update-handicaps.ts` |
| Tests | `astrosite/test/unit/bucket-lock.test.ts`, which is also where the reasoning behind each assertion lives |
| Published | `/events/hector/<id>/handicaps.json`, via `fieldHandicaps` — see phase 3, which is the part that is easy to miss |
| Admin | A Hector event editor, which does not exist yet — see phase 4 |
| Data | 13 Hector event files, none needing migration: unset is correct for all of them |

## Phase 1 — The field — **done**

```ts
bucketsLocked: z.boolean().optional(),
```

Optional and undefaulted, for the reason `data-ownership.md` records at the end: Firestore stores
what Zod produced, so a default is written back into every event file the first time one round-trips
through an export. Thirteen `"bucketsLocked": false` lines would say nothing their absence does not.

## Phase 2 — The job honours it — **done**

`updateBucketsForUpcomingEvents` already filtered on `bucketsAreOpen`; the lock is a second predicate
at the same call site, and a log line when it is what stopped a recompute. Both now live in
`bucketsToRecompute`, which returns the open events and the locked ones as two lists so the caller
can log the second — exported so the tests can reach it, the way `sortPlayersForBucketing` already
is. An event past its freeze is in neither list, so a locked Hector does not announce itself on every
tick for the rest of time.

Deliberately **not** folded into `bucketsAreOpen()`. That function answers a question about the
clock, it is derived from `bucketsFreezeAt`, and `bucketsFreezeAt` is published as an instant — a
lock is not a time and cannot be expressed as one without lying about when the freeze happened.
`field-handicaps.test.ts` asserts that the two agree; keeping the lock outside them keeps that true.

## Phase 3 — Publish it — **done**

`/events/hector/<id>/handicaps.json` carries `bucket_freeze` so that a consumer can tell a settled
split from a provisional one without reimplementing the 08:00 rule. The moment a lock can settle a
split before that instant, `bucket_freeze` alone stops answering the question it exists to answer,
and every consumer silently gets "provisional" for a split that is final.

So the payload gained `buckets_locked` alongside the instant — always present, `false` for an
unlocked event — and the bucketing basis in `fieldHandicaps`, which read handicaps as checked as of
`bucket_freeze`, now reads as of the earlier of that and the build itself when the event is locked.
The lock records no moment of its own, so the build is the only honest upper bound: citing a sweep
from after it as what a settled split was drawn on would claim the buckets used a reading nobody had
taken yet. This phase is not optional and not cosmetic: skipping it turns a new feature into a wrong
answer in a published file.

One thing beyond the four phases went with it. The event page titled its section "Field and Projected
Buckets" until the event started, and "Projected" is precisely the promise a lock withdraws, so a
locked split drops the word. The handicaps beside the names still refresh, per the table above.

## Phase 4 — The admin writes it — **not done**

Blocked on the same thing [`biography-locking.md`](./biography-locking.md) phase 3 is blocked on, for
the same reason. `admin/src/lib/ownership.ts` owns matchplay and mirrors everything else, so Hector
events are refreshed from the committed files by `npm run seed` after every scrape; a lock written to
the mirror is reverted within hours.

Until then the field is settable the way Hector events are edited today — by hand, in the JSON file,
committed. That is enough for the announced-split case, which is the one that justifies the plan.

## Is it worth it

Not obviously. The summary the decision was made on, kept as it was written:

- **What it buys.** One case: freezing an announced split before the first morning. That case is
  real, it happens at least once per tournament, and nothing else in the repository addresses it.
- **What it costs.** Four phases, one of which (phase 3) is a change to a published file's meaning
  and the easiest of the four to get wrong or forget.
- **What has already taken most of its value.** `bucketsAreOpen`. Before it, this field was the only
  thing standing between a Draft and a reshuffle; after it, it is a convenience for the days before.
- **What would make it clearly worth building.** A bucket editor in the admin. The lock alone
  protects a split CI computed; the pair lets someone fix one CI got wrong. If that editor is ever
  planned, this field goes in with it rather than ahead of it.

Building phases 1 and 2 alone, and setting the field by hand, is the cheap version and costs an
afternoon. Building phase 3 with them is not optional if they land.

**What was decided:** the cheap version, with phase 3, on 2026-09-18. The announced-split case is the
one that justified it and is the one it now covers. The bucket editor in the admin is still what
would make the rest worth building, and phase 4 waits for it rather than the other way round.
