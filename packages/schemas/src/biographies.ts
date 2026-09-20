import { type Player } from './players.ts';

/**
 * The players a run may rewrite, and the ones a lock is holding.
 *
 * Three lists rather than one, so a caller can say who it left alone and why.
 * `alreadyPublished` is the phrasing a locked biography still contributes to the
 * generator's "do not reuse this" context; see `biography-lock.test.ts` for why
 * dropping it would let a run echo a published sentence.
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
