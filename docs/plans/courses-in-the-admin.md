# Courses in the admin

*Written 2026-09-21 and executed as it was written. Steps 1-3 shipped with this document; step 4's
editor and machinery shipped the same day. What is left is the flag.*

Seventeen golf courses live in `astrosite/src/data/courses/` and are edited by hand. They were the
last section of the admin that said `planned`. This moves them into Firestore, renders them, and
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

### Step 4 — the editor, and owning the collection — **done**

Everything was wired first and `COURSES_ARE_OWNED` flipped on its own, which is the shape step 1 of
the other plan used and for the same reason: the flag is the piece worth being able to revert
cleanly.

**Flipped 2026-09-21**, after the acceptance test was run against production and came back
`courses: 17 exported, 0 changed, 0 removed` with an empty diff.

**The editor covers identity, contact, the prose and the tees** — what the plan named. Not the
scorecard: eighteen holes of par, stroke index and a length per tee is around 130 numbers off an
official card, a transcription exercise with no proofreader. Not the hole descriptions, the images
or the datasources either.

All of which have to survive a save, and none of which would survive a naive one. Zod strips what it
is not told about, so an editor that rebuilt the record from its own fields would delete the larger
half of a course with nothing failing — the same blind spot `course-schema-coverage.test.ts` names,
one level up. `courseFromForm` starts from the stored course and overwrites only what the form
carried; `course-details.test.ts` asserts that group by group.

**`description_long` was the trap.** It is prose *and images*, interleaved: 32 image entries across
15 of the 17 courses. A textarea holding only the paragraphs would have dropped every one. So the
form edits paragraphs by their index in that array, renders the images as read-only markers where
they sit, and rebuilds the sequence position by position. Paragraphs cannot be added or removed,
because that would mean deciding where the images go.

**A tee cannot be removed**, though `applyTeeEdits` supports it. Clearing a name would delete that
tee's scorecard column, and a form that deletes measurements by accident is worse than one that
cannot delete them at all. Adding is safe and is the blank row at the end.

Duplicate tee names are now unrepresentable: the schema refuses them, since two tees sharing a name
make a per-hole length ambiguous.

Both sides of the flip read the one flag:

- `saveCourse` refuses while it is false.
- The export publishes courses when it is true, through `withoutTeeIds`.
- **The seed stops writing them when it is true**, which is what stops the flip recreating the loop
  in the other direction — export publishes, next scheduled seed reverts.
- `--bootstrap` refuses over an admin-authored course, via `authoredCourses`.
- `export-admin-data.yml` stages `astrosite/src/data/courses`, added before courses were exportable
  so the two could never be out of step in the direction that loses work.

## What the acceptance test found

Run as the plan prescribes — seed, export, `git diff --exit-code`, with the flag flipped locally:

```text
courses: 17 exported, 17 changed, 0 removed
```

and **nothing semantically different at all**. The course files were indented with four spaces;
players, Hector events and `clubs.json` all use two, which is what `serializeJson` writes. Courses
were the outlier, and the export would have reformatted all seventeen on its first real run.

Settled as its own commit before the flip, which is exactly what the checklist says to do with this:
a reformat landing on the same day as the first real course edit would bury it. The export is
idempotent against the result.

That is a third reason a round trip is not a no-op, beside the two the other plan lists — schema
defaults and key order. **Formatting.** Worth knowing for step 2 of that plan.

## Step 5 — a description that can be composed, with uploaded images

*Asked for on 2026-09-21, once step 4's editor made plain how limiting a fixed sequence is.*

Step 4 lets a paragraph be rewritten and nothing else: the order is fixed, images are read-only
markers, and neither can be added or removed. That is defensible as a first cut and useless as a
final one — a description is a thing people compose.

So `description_long` becomes an editable ordered list of items, each a paragraph or an image, with
add, remove, replace and move. And an image can be uploaded from the machine doing the editing,
which is the part with infrastructure behind it.

### Where an uploaded image lives

**In a Cloud Storage bucket the admin service owns, referenced from the Firestore document by object
name.** The export downloads what a course references and writes it into git; the site keeps reading
committed files under `astrosite/public/images/` exactly as it does now.

That keeps the two-press publish honest. An upload is not public until an export runs, the same way
an edited biography is not public until an export runs, and a picture somebody uploaded and then
thought better of never reaches the repository at all.

The stored shape is one extra field, and the export translates rather than passing it through:

| | Firestore | committed file |
| --- | --- | --- |
| an uploaded image | `{ type: "image", object: "courses/{id}/{key}.jpg" }` | `{ type: "image", url: "/images/courses/{id}/uploaded/{key}.jpg" }` |
| an image already in git | `{ type: "image", url: "/images/..." }` | unchanged |

So the site needs no change at all, the committed data keeps the shape it has, and `object` never
reaches a file — the same division `withoutTeeIds` already draws for tee ids.

### Pruning has to be narrower than "unreferenced"

The obvious rule — delete images git holds that the document no longer references — **is wrong here,
and measurably so.** Under `astrosite/public/images/courses/` there are 326 files and 300 distinct
referenced paths. Of the 26 the documents do not name, 18 are `lafinca/holes/*.svg`: hole-layout
diagrams for the one course whose hole descriptions have not been written yet. Deleting them would
throw away work somebody did in advance.

It is also a much smaller slice of that directory than it sounds. `description_long[].url` accounts
for 32 of the 300; `descriptions[].layout` accounts for 234, and those are not edited here at all.

**So the export prunes only inside `images/courses/{id}/uploaded/`, and never outside it.** That
directory is created by the export, written only by the export, and everything in it is named after
an object the document references or is deleted. Anything else under `images/courses/` is somebody's
asset and is not the export's business.

The 26 orphans stay. If they should go, that is a deliberate commit somebody makes while looking at
them — not a side effect of the first course edit.

### How the form does it, with no script

Ordering is a number somebody types. Ties keep their existing order, so renumbering two rows leaves
the rest alone, and a fractional position slips a row between two others.

**That is what the form sends, and not what a person sees.** A position is how the form talks to
itself; somebody editing prose should not have to think about it. So `lib/reorder.ts` hides the
boxes, reveals a pair of arrows per row, and renumbers the hidden inputs as rows move — the second
progressive enhancement in this admin after `run-now.ts`, and the same shape: the page is complete
before it runs and better after.

Nothing reaches the server until Save. Moving a row reorders the DOM and rewrites hidden values;
there is no request and nothing to lose if the tab closes.

Arrows rather than dragging, for now. Dragging is nicer with a mouse and unusable without one;
arrows are keyboard-reachable and screen-reader-readable for free, which a drag handle only becomes
once the keyboard affordance is written back in — at which point the arrows exist anyway. Dragging
can be added on top; the ordering it produces is the same renumbering.

The buttons are rendered by the page and hidden with CSS rather than created in script, because a
button built in JS carries none of Astro's scoping attributes and comes out unstyled.

Removing is a checkbox. Adding is the pair of empty rows every description ends with — one
paragraph, one image — dropped on save when nobody touches them, which is the same trick the tee
table uses.

**And the upload happens on save, not at its own endpoint.** The form is `multipart/form-data`, so a
chosen file arrives with the save that references it: no upload endpoint, no client script, and no
window in which an object exists that no form knows about. The cost is that a rejected save loses
the chosen file, because a browser will not re-populate a file input.

### What this cost

- A bucket, and the first `google_storage_bucket` in `terraform/`. Uniform access, no public
  reading: the admin writes with its runtime identity, the export reads with the deployer's. Both
  bindings are **bucket-scoped**, because `hector-golf-tfstate` is in this same project and
  `iam.tf` has carried the warning about project-wide storage roles since long before this.
- `roles/storage.admin` for terraform-ci, which is project-wide because creating a bucket is. It
  passes the test `secretmanager.admin` passes and for the same reason — that identity holds
  `resourcemanager.projectIamAdmin` and can grant itself anything — rather than the comfortable
  reason, which is wrong and is written down beside it so nobody reaches for it twice.
- One route that serves an uploaded image back, so the editor can show a picture that has been
  uploaded and not yet published. Without it the preview is a blank square at exactly the moment
  somebody wants to look at what they chose.
- A laptop has no bucket. Uploading degrades to a disabled file input and a sentence saying so;
  everything else in the editor still works.

### What is not verified

**The bucket leg.** The bucket does not exist until `terraform apply` runs, so uploading, the
export's download, and pruning have been built and unit-tested but never run against Cloud Storage.
Reordering, removing, adding a paragraph and the whole save path *are* verified end to end against
an emulator, through the real multipart form.

The first thing to do after the apply is upload one image to one course and export it.

## Before the flip

The checklist from [`authoring-players-and-events.md`](./authoring-players-and-events.md) applies
unchanged, and its hardest-won item doubly:

**Run the acceptance test against production, and run it last.** Seed, export, `git diff
--exit-code`, expect nothing — but against the real store rather than an emulator, because an
emulator is seeded from the files it is then compared against and can only tell you about the code.
Run against production on 2026-09-21 it found two players whose clubs had been corrected by hand and
never mirrored; flipping without it would have published the stale values back.

Courses were more exposed to this than players were, for a reason worth keeping in view: they are
edited by hand, and no scheduled writer keeps their mirror warm. `refresh-admin-mirror.yml` now
fires on a push touching `astrosite/src/data/courses/**`, which closes the specific hole the players
flip fell into — a hand edit that reaches git and never reaches Firestore.

That makes the mirror self-maintaining rather than the check unnecessary. Run it anyway.
