# TODO

Each item says enough to be acted on without the conversation that produced it.
Things already recorded elsewhere are not repeated here — `docs/current/architecture.md`
§13 is the register of known gaps and drift in the code, and this file is what
somebody decided to do next.

Finished items are deleted rather than struck through. What was done and why is in the commit that
did it.

## Billing

**Two projects on the billing account have no budget of their own.** `koskela-automation` and
`gen-lang-client-0537211409` (created by AI Studio) bill to the same account as `hector-golf` and
are watched only by the account-wide backstop, which by design notices a spike and not a steady
leak — a few euros a month in either stays invisible until it pushes the account total past €4.
A small budget on each closes that, and leaves the account-wide one with the job nothing else can
do: catching projects that do not exist yet.

Both budgets that do exist are described in
[`docs/current/gcp-setup.md`](docs/current/gcp-setup.md).

## Buried in a `current/` document

Tracked nowhere but inside a document that otherwise describes how things are, which is what the
`docs/plans` and `docs/current` split was made to surface. See
[`docs/README.md`](docs/README.md).

The other item that was here — `event.bucketsLocked` and `player.biographyLocked`, specified by
`data-ownership.md` and implemented by nothing — has become two plans, which is where something
that has not happened belongs: [`docs/plans/biography-locking.md`](docs/plans/biography-locking.md)
and [`docs/plans/bucket-locking.md`](docs/plans/bucket-locking.md). The biography one is the live
problem of the two. `update-player-biographies` rewrites all 45 biographies on every run, twice a
month, so the field `data-ownership.md` classes as authored is in practice CI's, and a hand-edited
biography has a fortnight to live.

**Two of the four next steps the GCP setup was aiming at are still open.** They used to live at the
end of the setup document, which is why nobody saw them; splitting that document moved them here and
dropped the section. The admin service was built and the ownership question was settled; these were
not:

- *Migrate `handicaps` and the player images into Firestore.* Named as the place to start because
  Git handles them worst and neither is edited by a human, so a mistake is cheap. Still 1397 entries
  in `handicaps.json` and 40 image files on disk.
- ~~*Split the data loader.*~~ Done, and further than the playbook envisaged:
  `astrosite/src/code/data.ts` reads a snapshot served by the admin service, and there are no data
  files left to fall back to except one generated one. See
  [`plans/everything-to-firestore.md`](docs/plans/everything-to-firestore.md).

## Documentation

**`docs/current/architecture.md` describes the pre-Firestore data pipeline in several places.**
Its §9 CI/CD table, its data-file inventory and its account of how the site is built all predate
[`plans/everything-to-firestore.md`](docs/plans/everything-to-firestore.md), which deleted the 89
committed data files and pointed the build at the admin service. `data-ownership.md` has been
rewritten; this one has not, and it is the longer job.

The two workflows that used to be missing from the §9 table — `export-admin-data.yml` and
`refresh-admin-mirror.yml` — no longer exist, so that particular gap closed itself.
