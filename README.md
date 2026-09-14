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

Both of these were tracked nowhere but inside a document that otherwise describes how things are,
which is what the `docs/plans` and `docs/current` split was made to surface. See
[`docs/README.md`](docs/README.md).

**`event.bucketsLocked` and `player.biographyLocked` do not exist.**
[`docs/current/data-ownership.md`](docs/current/data-ownership.md) specifies both — separate empty
guard fields, so that no existing value is silently reinterpreted as a deliberate lock — and says
plainly that they are not implemented. Nothing in any schema, page or script has them.

`bucketsLocked` is now the narrower of the two: `bucketsAreOpen()` already stops CI at 08:00 on the
first morning, so the field is only about locking buckets *earlier* than that.

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

## Documentation

**The CI/CD table in `docs/current/architecture.md` §9 is missing rows.** `export-admin-data.yml`
and `refresh-admin-mirror.yml` are not in it. Noticed while adding `deploy-functions.yml` to that
table; left alone at the time to keep the diff narrow. The two check workflows were added to it when
they were renamed to `check-*.yml`, since that change was about their triggers anyway.
