# Courses in the admin

*Written 2026-09-21, and being executed as it is written. The first step shipped with this document;
what is marked **done** below is done, and the rest is the proposal.*

Seventeen golf courses live in `astrosite/src/data/courses/`, are edited by hand, and are the last
section of the admin that says `planned`. This moves them into Firestore, renders them, and
eventually lets somebody change a tee's name without opening a text editor.

## Why this one, and why now

**It is the cheapest migration left, and the only one that can happen this week.**

[`authoring-players-and-events.md`](./authoring-players-and-events.md) finished its step 1 on
2026-09-21 — players are authored in the admin — and its step 2, Hector events, is explicitly not to
be attempted in the week of a Hector. `HECTOR2026` is played 2026-09-24 to 2026-09-27. Courses have
no such constraint, because they have nothing to flip.

That is the substance of "cheapest", not a slogan. Every migration so far has been expensive in one
specific way: a scheduled writer was already writing the committed files, so the collection could
only move once that writer moved, and the day it moved was the day two systems could disagree about
who owned a record. Courses have no scheduled writer. Nothing in `.github/workflows/` touches them,
no npm script writes them, and the one piece of code that could — the interactive `mscorecard` CLI
under `astrosite/src/code/mscorecard/` — writes a raw API response to a path the operator types, not
to `src/data/courses/`. Checked on 2026-09-21 rather than assumed.

**And step 2 wants it.** A Hector event names the courses it is played on and, per round, a course
and a tee:

```jsonc
"courses": ["tahko-old", "tahko-new"],
"rounds": [{ "day": 1, "round": 1, "course": "tahko-old", "tee": "White", ... }]
```

An event editor therefore needs a course picker and a tee picker. With courses in Firestore it gets
both the way the player editor got its club list. Without them it has two bad options: free-text the
ids, or read seventeen files out of GitHub on every render — the `clubs.json` trick does not scale
from one file to a directory.

## What the data is

Seventeen files, one per course, against a schema that already exists and is already shared:
[`packages/schemas/src/courses.ts`](../../packages/schemas/src/courses.ts). That is a meaningful head
start — players and events both needed their schema moved into the shared package before the admin
could read them, and this one is there already.

Each course carries identity and prose (`name`, `homepage`, `contact`, `description_short`,
`description_long`, `images`, `datasources`) and an optional `course` object holding the golf: 78
tees across the seventeen, a scorecard of per-hole par, stroke index and lengths, and optional
per-hole descriptions in English and — for two Tahko courses — Finnish.

**`course-schema-coverage.test.ts` is the guard that matters here**, and it was written for exactly
this migration. Zod strips unknown keys rather than complaining, so a field the schema does not
mention is silently dropped; harmless while the files are the source of truth, and a *delete* the
moment anything reads a course through the schema and writes the result back. That test asserts that
parsing each file drops no leaf path. Nothing in this plan may make it fail, and nothing in this plan
may make it pass by narrowing what it checks.

## The tee problem, which has to be settled first

### The names disagree, and have always disagreed

Events reference tees as `Blue`, `White`, `Yellow`. Course data spells them `blue`, `white`,
`yellow` — plus `black`, `red`, `orange`, `pink`, `cherry`, `green`. Across all eighteen events and
all seventeen courses there is **not one exact match**; they agree only case-insensitively.

This has been invisible because `RoundsList.astro` resolves a round's tee with
`t.name.toLowerCase() === round.tee.toLowerCase()`. That is the only thing standing between the two
conventions, and it is one line in one component.

**Decision: normalise the course data to capitalised names — `white` becomes `White`.** That is the
form the events already use and the form a person would type. After it, the two agree exactly and
the case-insensitive comparison becomes belt-and-braces rather than load-bearing.

### Renaming a tee also rekeys the scorecard

Not obvious, and expensive to discover late. The per-hole lengths are an object *keyed by tee name*:

```jsonc
{ "hole": 1, "par": 4, "hcp": 7, "lengths": { "white": 302, "yellow": 275, "blue": 311 } }
```

and two components read it that way — `ScorecardHalfTable.astro` and
`pages/courses/[slug]/holes/[hole].astro`, both doing `hole.lengths?.[tee.name]`. Rename the tee
without rekeying the lengths and the lookup returns `undefined`: every length on every scorecard and
every hole page renders blank, with nothing thrown and nothing logged.

So the normalisation is one change to two places at once, and a test has to hold them together.

### Tees get a synthetic id, and it is not what gets exported

A tee's identity today *is* its name. That is fine while nothing references a tee and names never
change, and both of those stop being true: step 2 makes events reference tees, and a name is exactly
the sort of thing that changes — `White` becomes `60`, `Yellow` becomes `Gold`, a Czech course wants
`bílá` beside `white`. `name_local` already exists on nine tees for that last reason.

**Decision: every tee gets an `id` in Firestore, stable across renames, and the export does not emit
it.** The committed files keep saying `White`, because that is what the site reads and what
`RoundsList` matches on, and because a committed `"id": "a7f3…"` would be a number nobody can read in
a file people still open by hand.

The consequence is worth stating rather than discovering: **seed and export are not strict
complements for courses**, the way they are for players. A rebuild of Firestore from the committed
files re-derives each id from the tee's current name, so an id survives a rename only within
Firestore. That is acceptable precisely because nothing committed references an id — and it is the
line to watch: **the day an exported file references a tee id, ids have to start being exported.**
That day is step 2 of the other plan, if it chooses ids over names.

Ids are derived from the tee's name at import and never recomputed afterwards, so a tee renamed in
the admin keeps the id it was born with. They therefore *look* like the name they started as, which
is a readability convenience and not a fact anyone may rely on: after `White` is renamed to `60`, its
id is still `white`.

## Steps

### Step 1 — normalise the tee names in the committed files — **done**

Before anything moves, because it is a change to the data rather than to where the data lives, and
because everything downstream is easier when the two conventions have already been reconciled.

78 tee names capitalised and 1,433 `lengths` keys rekeyed to match, across all seventeen courses.
`name_local` was left alone: `bílá` is Czech prose, not a key, and nothing looks it up.
`course-tee-names.test.ts` now holds the names, the lengths keys and the events' references
together.

**Done as a text edit rather than a parse and re-serialise**, which is worth recording because the
first attempt was the latter and reformatted every file: no `json.dumps` setting reproduces these
files byte for byte, so rewriting them turned a 389-line change into a 7,025-line one. The edit that
shipped replaces exactly the 78 names and 1,433 keys, counted against what the parsed data predicted
before the edit ran.

Verified as case-only: for each of the seventeen, the file before and after are identical once tee
names and `lengths` keys are lowercased on both sides. No behaviour change on the public site —
`RoundsList` already matched case-insensitively, the `lengths` lookup keeps resolving because both
sides moved together, and a built page renders real numbers with no `undefined`.

### Step 2 — import into Firestore, as a mirror — **done**

The same shape the players mirror had: `npm run seed` writes courses into Firestore, the admin reads
them, and the committed files stay the source of truth.

**A mirror rather than owned, deliberately.** Owning a collection means the seed stops writing it,
and there is no course editor yet — so owning it now would take away the only way to change a course
and offer nothing in its place. The players migration had the same shape for the same reason, and
that ordering is what kept every step reversible.

What shipped:

- `COURSE_FILES` in `ownership.ts`, beside `PLAYER_FILES`, because the export will want the same
  glob. **No `COURSES_ARE_OWNED` beside it**, and `ownership.test.ts` asserts that absence — a flag
  nothing reads is worse than none, and it is exactly the sort of thing added later for symmetry.
- One line in `seed.ts`, on no gate at all.
- An `enrich` hook on the seed's helper, applied after the schema and before the write, so tees get
  their ids on the way in. Courses are its only caller, and its doc comment says what it is not for:
  changing anything the file says would make the store disagree with the file it was seeded from,
  which is the one property a mirror has.
- `teeId()` and `withTeeIds()` in `@hector/schemas/src/courses.ts`, with `id` optional on the tee
  schema so the committed files stay valid without it.

Verified against an emulator: seventeen documents, `konopiste-radecky` storing
`black=Black/černá, white=White/bílá, yellow=Yellow/žlutá, blue=Blue/modrá, red=Red/červená` — ids
decoupled from names, and the Czech names carried through.

### Step 3 — render them read-only — **done**

`sections.ts` moves `courses` from `planned` to `read-only`, and the admin gets a course list and a
course page: identity, contact, the tees with their ratings and slopes, and the scorecard. This is
the step that makes the import visible and is the point at which the data can be checked by looking
at it.

`sections.test.ts` needed no change and anticipated this in a comment — *"the day Courses is built
there is no `planned` section left"* — which is why its loops tolerate an empty list.

One thing did need changing. `MirrorNotice` hard-coded
`docs/plans/authoring-players-and-events.md` as where the flip is planned, which is now wrong for
courses; `Mirror` gained an optional `plan`. A notice pointing at the wrong document is worse than
one pointing at none, because it sends somebody to a plan that does not mention what they are
looking at.

### Step 4 — the editor, and owning the collection — *not started*

The remaining work, and the part that needs the decisions above to have been made properly.

- An editor for what a person authors: name, homepage, contact, the descriptions, and the tees.
- `COURSES_ARE_OWNED` — or, more likely, courses joining the same ownership vocabulary players use.
- An export path, writing names and not ids.
- `export-admin-data.yml` staging `astrosite/src/data/courses` — **it has to be added there
  explicitly**; the export deciding to publish a collection means nothing if the workflow does not
  stage it. That was a real bug in the players migration, caught the day before this was written.

Nothing about step 4 is hard. It is deferred because steps 1-3 are worth having on their own — they
unblock step 2 of the other plan — and because an editor written before anybody has looked at the
imported data is an editor written against assumptions.

## Before the flip, when step 4 comes

The checklist from [`authoring-players-and-events.md`](./authoring-players-and-events.md) applies
unchanged, and its hardest-won item doubly:

**Run the acceptance test against production, and run it last.** Seed, export, `git diff
--exit-code`, expect nothing — but against the real store rather than an emulator, because an
emulator is seeded from the files it is then compared against and can only tell you about the code.
Run against production on 2026-09-21 it found two players whose clubs had been corrected by hand and
never mirrored; flipping without it would have published the stale values back.

Courses are more exposed to this than players were, not less: they are edited by hand today, they
have no scheduled writer to keep the mirror warm, and `refresh-admin-mirror.yml` does not fire on a
push that touches them.
