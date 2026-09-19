import { type Player } from "@hector/schemas/src/players.ts";

/**
 * The players a run may rewrite, and the ones a lock is holding.
 *
 * `player.biographyLocked` is somebody saying "this paragraph is mine now". The
 * field it guards is classed *authored* in `docs/current/data-ownership.md` and
 * behaved as *derived* without this: every run regenerated all 45 with no diff
 * and no skip, so a hand-written biography lived a fortnight and then vanished
 * in a commit nobody was watching.
 *
 * A separate flag rather than "fill only when empty", because all 45 players
 * have a biography and that guard would therefore never write again — not for a
 * better prompt, not for a first Hector win, not for a hint somebody added to
 * `player.misc` for exactly that purpose. The generated text is *meant* to be
 * regenerated; the part a person wrote is not, and a full field cannot tell
 * those apart.
 *
 * Both lists are returned rather than one filtered list, so the caller can say
 * who it left alone and why, exactly as `bucketsToRecompute` does in
 * `update-handicaps.ts`. A lock that stops a rewrite silently is a suspected bug
 * the first time somebody wonders why a correction did not take.
 *
 * `alreadyPublished` is the third thing a run needs and the one that is easy to
 * leave out. `otherGeneratedBiographies` is the "do not reuse this phrasing"
 * context the generator is given, and a locked biography is still on the page
 * beside everything this run writes — so dropping those players from the run
 * entirely would hand the model a roster with holes in it and let it echo, in a
 * biography it does write, a sentence already published under somebody else's
 * name. That is the one way this change could make the output worse than not
 * having it, so the seed is returned here rather than assembled at the call site
 * where nothing would fail if it went missing.
 *
 * ## Why this is not in `update-player-biographies.ts`, beside its caller
 *
 * `bucketsToRecompute` lives in the workflow it belongs to and is imported from
 * there by `bucket-lock.test.ts`, so this file looks like a deviation. It is,
 * and the reason is that `update-player-biographies.ts` cannot be imported
 * safely: `golfClubs` there is a module-level IIFE, so merely importing the
 * module scrapes WiseGolf and writes `src/data/clubs.json` from whatever comes
 * back. A test importing it has no credentials, so the answer is nothing, and
 * the file — 1,402 lines of committed club data — is rewritten as `[]`.
 *
 * That was discovered by writing the first test this script has ever had. Until
 * there is a reason to unpick the IIFE, the logic worth testing lives on this
 * side of the line, where importing it does only what importing should.
 */
export const biographiesToRegenerate = (
    players: Array<Player>,
): { regenerate: Array<Player>; locked: Array<Player>; alreadyPublished: Array<string> } => {
    const locked = players.filter((p) => p.biographyLocked === true);
    return {
        regenerate: players.filter((p) => !p.biographyLocked),
        locked,
        alreadyPublished: locked.flatMap((player) => player.biography ?? []),
    };
};
