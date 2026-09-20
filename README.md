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
`data-ownership.md` and implemented by nothing — became two plans, which is where something that has
not happened belongs. Both have since been built: `event.bucketsLocked` on 2026-09-18
([`docs/plans/bucket-locking.md`](docs/plans/bucket-locking.md), phases 1-3) and
`player.biographyLocked` on 2026-09-19
([`docs/plans/biography-locking.md`](docs/plans/biography-locking.md), steps 1-2). The bucket one is
still set by editing the committed file; the biography one is set by the admin.

The biography one was always the live problem of the two: `update-player-biographies` rewrote all 45
biographies on every run, twice a month, so the field `data-ownership.md` classes as authored was in
practice CI's, and a hand-edited biography had a fortnight to live. That workflow is gone as of
2026-09-21 — the generator runs in the admin service now — and saving a biography in the admin sets
the lock, so an edit is no longer something you have to remember to protect.

**Two of the four next steps the GCP setup was aiming at are still open.** They used to live at the
end of the setup document, which is why nobody saw them; splitting that document moved them here and
dropped the section. The admin service was built and the ownership question was settled; these were
not:

- *Migrate `handicaps` and the player images into Firestore.* Named as the place to start because
  Git handles them worst and neither is edited by a human, so a mistake is cheap. Still 1397 entries
  in `handicaps.json` and 40 image files on disk.
- *Split the data loader.* `astrosite/src/code/data.ts` is still filesystem-only — zero Firestore
  references — so the Firestore implementation the playbook envisages, with `astro dev` and
  `npm test` still running against files, has not been started.
