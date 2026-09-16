# Moving all of the site's data into Firestore, at once

Every JSON file under `astrosite/src/data/` becomes a Firestore collection, the files are deleted,
and the site builds by asking the admin service for the data instead of reading the repository.

This is the **alternative** to [`handicaps-to-firestore.md`](./handicaps-to-firestore.md), which
reaches the same destination one dataset at a time. Both are written up because the choice between
them is a real one and mostly not technical: they differ in how much is unknown at the moment of
cutover, and in how long the project spends in a state nobody has seen before.

Read [the comparison](#which-one) first if you are choosing. The rest is what this one involves.

## What moves

89 files, seven kinds:

| Data | Files | Written today by | Becomes |
| --- | --- | --- | --- |
| Players | 45 | three scrapes, plus hand edits | `players` |
| Events | 18 | `update-leaderboards`, the admin, hand edits | `events` |
| Courses | 17 | by hand, only | `courses` |
| Leaderboards | 6 | `update-leaderboards` | `leaderboards` |
| Handicap observations | 1 (1,406 entries) | `update-handicaps` | `handicap-observations` |
| Handicap sweeps | 1 | `update-handicaps` | `handicap-checks` |
| Clubs | 1 | `update-player-biographies` | `clubs` |

Three of them — matchplay events, and the `players` and `events` mirrors — are already in Firestore.
`admin/scripts/seed.ts` puts them there and `admin/scripts/export.ts` brings matchplay back out. This
plan is largely the act of deleting the second half of that pair and letting the first half stop
being a mirror.

## Why this is one change and not seven

The pairing rule in [`data-ownership.md`](../current/data-ownership.md) is what makes the
incremental version slow:

> A collection moves into the exported column on the day the admin can author it **and** its
> scheduled writer has been moved to Firestore. Those two things have to happen together: either one
> alone recreates the conflict in the other direction.

Done one dataset at a time, every dataset spends a period in a hybrid state — written in one place,
read from another, reconciled by code that exists only to bridge the two and is then deleted. Seven
datasets, seven bridges, seven windows in which the two stores can disagree and a person has to
decide which is right.

Done at once there is exactly one such window, and it is the length of a deploy.

The cost is that the window is total. If the cutover is wrong, everything is wrong at the same time.
That is the trade in one sentence, and the rest of this document is about making that window as
short and as reversible as it can be made.

## The design

### One snapshot, not seven endpoints

The admin exposes `GET /api/data/snapshot`, which returns every collection in one document:

```json
{
  "generatedAt": "2026-09-16T04:12:09Z",
  "players": [...], "events": [...], "courses": [...],
  "leaderboards": [...], "clubs": [...],
  "handicapObservations": [...], "handicapChecks": [...]
}
```

One request rather than seven, because the site build wants all of it and wants it consistently.
Seven requests can straddle a write; one cannot. The whole payload is around 400KB, which is small
enough that streaming it is not worth the complexity of making it consistent some other way.

The site fetches it once at the start of the build and every loader reads from it. That keeps the
change to `astrosite` almost mechanical: `data.ts` already loads at module scope with top-level
`await`, so `await glob(...)` becomes `await snapshot()` and every consumer is untouched.

### The build's fallback, and the recommendation

This is the one genuinely open question in the plan, so both answers are written out.

**Option A — a credential-less fallback.** The build fetches the snapshot when it has credentials
and fails loudly if that fetch fails. With no credentials at all, it reads a committed
`astrosite/src/data/snapshot.json` and prints a notice saying the data may be stale.

**Option B — the API is the only input.** No data in the repository at all. The build requires
credentials, always.

Option B is the more honest expression of "Firestore is the system of record", and it is tempting
for exactly that reason. It costs three things:

- `check-site.yml` runs the full build on every pull request. It would need Workload Identity
  credentials to do so, which is a change to a CI job that currently needs none.
- **A pull request from a fork could not be built at all.** Forks cannot hold those credentials.
- `npm run build` on a laptop would need `gcloud auth application-default login` and a role in the
  project. Today it needs a checkout.

**The recommendation is Option A**, and the reason is narrower than it looks: not "hermetic builds
are good", but that the fallback is what makes the cutover reversible. The snapshot file is also the
only remaining copy of the data outside Firestore, and a system of record with no second copy is a
system of record with no undo. Option A costs one generated file; Option B costs the ability to
answer "what did it look like last Tuesday" with anything other than a Firestore backup.

The file is *generated*, not authored: the admin rewrites it when data changes, the same way it
commits the backup in the incremental plan, and nothing edits it by hand. It is one file rather than
89, and it is not the build's normal input — only its fallback.

Option B remains one configuration change away, if the fallback turns out to be the thing that hides
a broken deploy. That is the real argument against A and it is worth saying plainly: a fallback that
silently succeeds is a fallback that can mask the API being down for a week. The rule below is what
keeps that from happening, and it has to be exactly this rule:

> Credentials present and the fetch fails → **fail the build**. No credentials at all → fall back,
> and say so.

Never "fall back when the fetch fails". That version is the one that hides outages.

### The writers

Deleting the files breaks every scrape, because every scrape's last step is to write one and commit
it. They have to write to Firestore instead, and they have to do it before the files are deleted
rather than after.

This is where the big-bang version stops being smaller than the incremental one. `update-handicaps`,
`update-leaderboards`, `update-player-biographies` and `update-player-club-memberships` all need the
same treatment the incremental plan gives to one of them — and they need the same things around it:
a lock, so two of them cannot race; a run log, because the Operations page reads GitHub's run list
and there is no run to read once a workflow stops committing; and a way to write the snapshot back
to git.

The plan for the writers is therefore the same as the incremental plan's, applied four times in one
change instead of once. It is not avoided by doing everything at once. It is only compressed.

### What `export.ts` and `seed.ts` become

Both are deleted. They are the two halves of the mirror, and the mirror is the thing this removes:
`seed.ts` pushed committed files into Firestore, `export.ts` pulled matchplay back out, and
[`data-ownership.md`](../current/data-ownership.md) devotes a section to the rule that stops them
forming a loop. With one system of record there is no loop to prevent.

`refresh-admin-mirror.yml` and `export-admin-data.yml` go with them.

## The steps

The order is not negotiable: writers before deletion, deletion last.

1. **Migrate.** `admin/scripts/migrate.ts` imports all 89 files into Firestore, validating every
   record through the schema it will be read back with. Idempotent, and safe to run repeatedly while
   the rest of the work happens.
2. **Serve.** `GET /api/data/snapshot` on the admin, behind IAP.
3. **Read.** `astrosite` builds from the snapshot, with the fallback rule above. At this point the
   files are still there and still correct — the build has simply stopped reading them, which is the
   step that can be verified by comparing two built sites byte for byte.
4. **Write.** The four scrapes move into the admin service as jobs, with the lock, the run log and
   the append-only guard. Each one's first deployment is in shadow mode.
5. **Delete.** The 89 files, `seed.ts`, `export.ts`, and the two workflows. The generated
   `snapshot.json` is the only data file left.

Steps 1–3 are reversible by reverting a commit. Step 5 is reversible by reverting a commit *and*
being confident Firestore is right, which is a different kind of reversible and is why it is last.

## What this costs that the incremental plan does not

**The site build gains a network dependency and an authentication step.** Today a checkout is
sufficient to produce the site. Afterwards, a build that matters needs a working admin service, a
reachable Firestore, and a valid token. Three new things can break a deploy that previously could
only be broken by the code.

**`check-site.yml` changes meaning.** It currently proves the site builds from what is in the
repository. Afterwards it proves the site builds from the fallback snapshot, which is not the same
claim and is weaker in exactly the way that matters.

**The blast radius is everything.** A mistake in the snapshot shape, the schema validation or the
loader takes out every page rather than the handicap chart.

**Four scrapes have to be right at once.** The incremental plan gets to learn from the first one.

## What it buys

**One cutover instead of seven.** No dataset spends months half-migrated, and no bridge code is
written to be deleted.

**The editors can be built for everything at once.** Which is the actual goal — the admin cannot
grow an editor for courses or events while a scrape is still authoritative for them, and this makes
all seven eligible on the same day.

**`data-ownership.md` gets much shorter.** The mirror, the loop, the export's narrow scope and the
rule about moving a collection only in pairs all describe a situation that stops existing.

**No more `git pull -r && git push` races.** The shared `data-update` concurrency group, the reason
it is shared, and the scheduler comments explaining it all go away with the commits they serialise.

## Which one

| | Incremental | All at once |
| --- | --- | --- |
| Unknowns at the first cutover | One dataset, the safest one | Seven datasets, including the hand-maintained ones |
| Time in a hybrid state | Months, one dataset at a time | One deploy |
| Bridge code written then deleted | Per dataset | None |
| If the cutover is wrong | The handicap chart is stale | Every page is wrong |
| Scrapes to move | One, then learn, then three | Four, at once |
| Hermetic site build | Kept until step 3, then a fallback | A fallback from the start |
| Deadline pressure | Real — the comparison needs the golf season | None; there is no live comparison to run |
| `data-ownership.md` | Grows a transition section per dataset | Loses several sections |

The honest summary: **the incremental plan is slower and the big-bang plan is riskier**, and neither
of those is a tiebreak on its own. What should decide it is the answer to a question this document
cannot answer, which is how much confidence there is in the schema validation. Everything that makes
the big-bang version dangerous is downstream of one thing — 89 files being read back as the same
data they were written as — and that is testable offline, today, against the files that already
exist, before a single decision is made. The migration script in step 1 does exactly that check and
prints the differences.

Run it. If it is clean across all 89 files, the big-bang version's risk is much smaller than it
looks. If it is not clean, the incremental version is not safer either — it just finds out later.
