# Experiments

Things that were built, deployed, and then not adopted.

An experiment is code that exists and runs — it is not a plan, because nobody is waiting to execute
it, and it is not `current/`, because describing it there would overstate what it does for us. Two
of the four Cloud Functions in `backend/backend-functions/` are in exactly that position: deployed
on every push to `main`, reachable at a public URL, and called by nothing.

| | | verdict |
| --- | --- | --- |
| [`player-avatar-generation.md`](player-avatar-generation.md) | `GeneratePlayerAvatar` — a cartoon headshot from a photo and a style reference | **Not adopted.** Uniformity across arbitrary source photos was never good enough |
| [`scorecard-extraction.md`](scorecard-extraction.md) | `ExtractScorecardInformation` — a scorecard screenshot read into typed scores | **Not adopted.** Accuracy and reliability never convinced us; three prompt generations, the third unfinished |

## Why this is its own directory

Because the alternatives are both worse. Documented in `current/architecture.md`, an experiment
reads as part of the working system — which is how §10 of that document came to open by dividing
the backend into "three Gemini wrappers and a proxy", give three of its four table rows to Gemini
functions, and close with a paragraph on avatars the repository does not contain. Deleted entirely,
the next person to open `backend/backend-functions/src/` finds four functions, two CLIs and eight
prompt files, with nothing saying which of them matter.

So: `current/` describes what the system does, and says in one line that these two exist and do not
count. Here is where the detail lives, along with the thing a description cannot carry — what was
tried, and why it was not enough.

## What an experiment document owes you

Four things, in this order, because the order is what makes the file worth keeping:

1. **What it does**, concretely enough to call it.
2. **Why it is not in use** — the actual objection, not "it was an experiment".
3. **What state it is in** — deployed or not, tested or not, what it costs to leave alone.
4. **What would have to be true** to adopt it, or to delete it.

The fourth is the one that prevents this directory from becoming an attic. An experiment nobody can
state a resumption condition for is a deletion waiting to be approved, and saying so here is
cheaper than rediscovering it.

## Where these sit in the lifecycle

An experiment leaves this directory in one of two directions, same as a plan leaves `plans/`:

- **Adopted** — the description moves into `current/architecture.md` §10 beside the functions that
  are in use, and this file goes away. What was tried and rejected along the way is history, and
  the Git log is where history belongs.
- **Abandoned** — delete the function, its prompts, its tests and its deploy matrix entry, and
  delete the file. The pull request that removes it is the record.

Neither has happened to these two. Leaving them deployed costs a build slot in
`deploy-functions.yml` and nothing else: gen2 functions scale to zero, and an endpoint nobody calls
bills nothing. That is why the decision has been easy to defer — but it is a decision, not a state.
