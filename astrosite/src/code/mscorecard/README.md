# mScorecard SDK

A typed client for the mScorecard backend, built on Node's global `fetch()`. The
protocol it wraps — reverse engineered from the iOS app's traffic — is documented
in [`../../../docs/mscorecard-api.md`](../../../docs/mscorecard-api.md).

```ts
import { MScorecardClient } from "../code/mscorecard/index.ts";

const client = new MScorecardClient();
await client.login(process.env.MSCORECARD_EMAIL!, process.env.MSCORECARD_PASSWORD!);

const roster = await client.listRoster();
const named = (name: string) => roster.find((p) => p.name === name)!;

const round = await client.createRound({
    courseID: "0121568050825406011", // Hirsala Golf, 18-hole course
    nine1: 1,
    nine2: 0, // front nine only
    players: [
        { playerID: named("Lasse Koskela").playerID, teeID: "208146", extTeeID: 5, courseHcp: 17, hcpBefore: 14.8, gender: "1", hcpRound: 1 },
        { playerID: named("Toni Marttila").playerID, teeID: "208146", extTeeID: 5, courseHcp: 36, hcpBefore: 36, gender: "1" },
        { playerID: named("Lotta").playerID, teeID: "208149", extTeeID: 2, courseHcp: 54, hcpBefore: 54, gender: "0" },
    ],
});

await round.scoreHole(1, { "Lasse Koskela": 5, "Toni Marttila": 4, Lotta: 7 });
await round.scoreHole(2, { Lotta: 5, "Toni Marttila": 4, "Lasse Koskela": 3 });
await round.finish();
```

## What the SDK takes care of

**The access token rotates.** Almost every `/api/v2.3` response carries a fresh
`accessToken` that silently invalidates the previous one. The transport writes it
back after every request; pass `onTokenRotated` if you persist sessions.

**Each round has a `ts` version token.** Every write must echo the `ts` from the
previous response on that round. `MScorecardRound` owns that chain and serialises
writes, so overlapping calls cannot send the same stale token.

**`sid` is not a player ID.** It is a scorecard *row* ID: it identifies a player in
one round only, and the server mints it during round creation. `createRound()`
sends negative placeholders (`-1`, `-2`, …) and maps the returned `sid`s back, so
you can address players by name, `playerID` or slot and never touch a `sid`:

```ts
round.sidFor("Toni Marttila") === round.sidFor("1788645892735896"); // true
```

**A three-nine club is one facility, not three courses.** Such a club is listed
once per *pair* of nines, so Nevas Golf appears three times. The course ID encodes
the pair — `0<nine1><nine2>1` then a facility ID — so the variants can be grouped
back together; club name cannot do it, since most clubs with several courses have
genuinely separate ones. `client.searchFacilities()` returns them grouped, and
`courseForNines()` picks the right variant once the nines are known.

**Holes are numbered by the course, not by the card.** A back-nine round plays holes
10-18, and those are the numbers the API wants — `round.holes` gives them in order.
Scoring such a round with 1-9 is accepted, returns a fresh `ts`, and registers
nothing at all. Confusingly the card that comes back *is* indexed by position, so the
SDK converts in both directions: `scoreHole(11, …)` writes `h: 11` and lands at
`card()[1]`.

**Every round is a practice round until you say otherwise.** `hcpRound` defaults to
0, so nothing the SDK creates can land in a handicap record by accident.
`round.setCountsTowardsHandicap(player, true)` flips it — per player, since one
person in a group can be posting a score while another is out for practice — and
`submitForHandicap()` refuses to run if nobody has been switched on.

**Finishing and submitting are idempotent.** `finish()` marks the round complete
and blocks further scoring; `submitForHandicap()` forwards it for official handicap
calculation and works whether or not you finished it first. Calling either twice
does nothing the second time, so a retry cannot double-submit a round.

**A locked round accepts writes and ignores them.** A round already processed for
handicap purposes answers a score write with HTTP 200, a fresh `ts` and `noEdit: 1` —
nothing that looks like an error. The SDK raises `MScorecardNotEditableError` rather
than reporting a write that went nowhere.

**Putting a player on a card** is `client.addPlayerToRound(round, spec)`, which
returns the new slot with its `sid`. Only the new row goes out — the opposite of a
removal, which re-sends every survivor. A real mScorecard user has to be found with
`searchPlayers()` and added with `addFriend()` first, since a round can only point at
someone the account already knows.

**A new round is Stableford** unless `gameFormat` says otherwise — 0 Stroke Play,
1 Stroke Play NET, 2 Stableford. The format decides only how the card is totalled, so
it can be changed afterwards without touching the scores.

**Round-level edits** are `round.setDate(when)` and `round.setGameFormat(format)`:
the whole envelope with the new value and no scores at all. The date is local
wall-clock time; the format decides only how the card is totalled. Both refuse on a
submitted round. Oddly the date names itself in `modifiedFields` and the format does
not, so that array is not a general record of what changed.

**Taking a player off a card** is `round.removePlayer(player)`: their row goes in
`scoresDeleted`, the survivors are renumbered so `playerNum` has no gap, and the
round refuses to empty itself — an empty round is better deleted.

**Deleting needs none of that.** `DELETE /rounds/{id}` carries no `ts` and no
body, and answers with a bare `[]` rather than an object — so
`client.deleteRound(id)` works without reading the round first, and
`round.delete()` works even on a finished round.

**Two backends, one login.** Courses and rounds are on the v2.3 REST API; the
player roster and friend search are only on the legacy PHP endpoints, which want
the hashed `token` rather than the password. `login()` collects both credentials.

## Layout

| File | Contents |
| --- | --- |
| `client.ts` | `MScorecardClient` — login, courses, roster, round creation |
| `facilities.ts` | Grouping a club's nine-pair variants into one facility |
| `round.ts` | `MScorecardRound` — the `sid` map, the `ts` chain, scoring |
| `http.ts` | Transport for both backends, incl. token rotation |
| `types.ts` | Domain types |
| `errors.ts` | `MScorecardError` and its subclasses |
| `ids.ts` | Client-minted round/player IDs and the date wire format |

## Caveats

**Friends are added by user ID, not by uploading a player.** `addFriend(userID)`
takes the `userID` from a `searchPlayers()` hit. The roster entry it creates starts
at `friendStatus: 1` and becomes 2 once accepted — and that matters, because an
accepted friend goes into a round under *their own* player record rather than our
copy of them. `roundReferenceFor()` works out which IDs to use.

`addRosterPlayer()`, for a player of your own invention, is still built on a shape
that was **not** in any capture — every one uses `download=1` — and is marked as such
in the source. Verify it before relying on it.

`courseHcp` is caller-supplied: the app computes it client-side and the server stores
whatever it is sent. Every captured value fits `round(index × slope / 113 + (CR − Par))` capped at 54 for
a WHS index (`hcpType` `"9"`), using the course's default eighteen-hole rating and
par, with a plain club handicap (`"0"`) used verbatim. It reproduces every value the
app has been seen to write, now across three courses: 14.8 → 17 and 14.1 → 14 for
Lasse, 36 → 36 for Toni, 54 → 54 for Lotta, and 54 → 50 for Luka off Gumböle's reds.
Note it is *not* halved for a nine-hole round. The SDK still asks for the number
rather than deriving it; `cli/handicap.ts` has the rule.

## The CLI

```bash
npx tsx src/code/mscorecard/cli/main.ts help
```

| Command | What it does |
| --- | --- |
| `create-round` | Creates a round and scores it, leaving it unfinished |
| `finish-round` | The same, then marks it finished |
| `submit-round` | `finish-round`, then submits for handicap calculation |
| `list-rounds` | Lists rounds and shows one hole by hole |
| `show-round <id>` | Prints a round as the server stores it; `--json <file>` saves the raw response |
| `edit-round [id]` | Changes the scores on a round that is still open; asks which round if given no ID. `-` clears a hole |
| `self-test` | A scratch round, checked hole by hole and then deleted |
| `help` | The usage text. What you get if you name no command |

`list-rounds`, `show-round` and `edit-round` all end by offering whatever the round
is still open to — finish, submit as a handicap round, remove a player, delete —
worked out from the round itself rather than from a list entry, since two of the
three never see one. A submitted round offers nothing.

There is no default command: running it bare prints usage and stops, rather than
guessing at something that writes to a real account. An unrecognised or duplicated
command is refused with a non-zero exit. `help`, a bad command line and `show-round`
all work without a terminal; the interactive commands check for one *before* logging
in.

Every create command reads the round back from the API afterwards and prints the
stored card beside the scores that were meant to go in. Reading it back rather than
trusting the write is the point — a card can be accepted and still be filed against
the wrong holes.

`self-test` goes further: it scores in scrambled batches, asserts the round trip hole
by hole, switches the handicap flag on and back off, and deletes the round in a
`finally` so a failed check leaves nothing behind. The sharpest check compares
**Stableford points**, not just the raw array. Reading a round back embeds the course
as the *server* has it, pars and stroke indexes included, so the points can be
recomputed from the server's own view of which holes were played. At Tapiola Golf the
2nd is a par 3 and the 11th a par 5: six strokes there is a bogey worth a point on
the back nine, and three over for nothing on the front. An array comparison cannot
see that; the points can.

`self-test` deliberately never calls `submitForHandicap()` — that is the one step
that reaches the Finnish Golf Association and cannot be undone, so it is the one step
not rehearsed. Everything before it is covered.

### Layout

| File | Contents |
| --- | --- |
| `main.ts` | Entry point: parses, logs in, dispatches, owns the prompter's lifetime |
| `options.ts` | Commands, options and the usage text — the one description of each |
| `prompts.ts` | The readline interface behind a `Prompter`, passed rather than imported |
| `select.ts` | Choosing club, nines, tee and player |
| `run.ts` | The three create commands |
| `rounds.ts` | `list-rounds` and `show-round` |
| `actions.ts` | What a round is still open to, offered by all three |
| `when.ts` | Reading and showing a date and time — pure, and unit tested |
| `edit.ts` | `edit-round` |
| `card.ts` | Laying a stored round out as a scorecard, shared by the above |
| `selftest.ts` | The `self-test` command |
| `nines.ts` | Which nines a course can be played in — pure, and unit tested |
| `handicap.ts` | Course handicap the way the app computes it — pure, and unit tested |
| `scorecard.ts`, `report.ts`, `util.ts` | Reading a card in, printing one out, small helpers |

## Tests

`test/unit/mscorecard/` runs against a stub `fetch` and never touches the network:

```bash
npx vitest run --dir ./test/unit/mscorecard
```
