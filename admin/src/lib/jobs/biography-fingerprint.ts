import { createHash } from 'node:crypto'

import type { PlayerBiographyInput } from '@hector/schemas/src/biographies.ts'

/**
 * Whether the facts behind a biography have changed since it was written.
 *
 * ## Why a fingerprint rather than a date
 *
 * A biography is written out of a fixed set of facts — who the player is, which
 * Hectors they have played, what they have won, whether the next one is ahead of
 * them — and it goes out of date exactly when one of those changes. A date could
 * only ever approximate that. It said "stale" to all forty-five whenever the
 * comparison moved, whether or not anything about any of them had changed, and
 * it said nothing at all about a player who joined a field, won a trophy,
 * changed clubs or had a prompt hint added.
 *
 * Fingerprinting the input says precisely what the date was reaching for, and
 * costs a run nothing: 45 hashes against 45 model calls.
 *
 * ## What is in it, and the one field that must not be
 *
 * Everything the generator is told about *this player and the tournament* —
 * which is `PlayerBiographyInput` minus `otherGeneratedBiographies`.
 *
 * That exclusion is not a nicety, it is the whole thing working or not. The
 * do-not-echo context is the other players' biographies, so it changes for
 * everybody whenever anybody's text changes, and every run would find all
 * forty-five stale, forever. It is also not a fact about the player: the same
 * biography is equally correct whoever else was on the page when it was written.
 *
 * ## `PROMPT_VERSION`, for the changes the input cannot see
 *
 * The other reason a biography goes out of date is that we changed what we ask
 * for — a better instruction, a corrected fact in the system prompt, a fix like
 * the one that stopped the model writing `Troph&eacute;e`. No input changes, so
 * no fingerprint would, and the roster would keep its old text indefinitely.
 *
 * Bumping this is therefore a deliberate "redraft everybody", and it is a
 * constant rather than a hash of the prompt template for that reason: most edits
 * to that file are wording nobody needs 45 model calls spent on, and the ones
 * that are worth it are a judgement somebody should make on purpose.
 *
 * The prompt itself lives in `backend/backend-functions`, which shares no code
 * with this workspace — so hashing the real template is not available here even
 * if it were wanted.
 */
export const PROMPT_VERSION = 1

/**
 * The facts, in a fixed order, as one string.
 *
 * Built by hand rather than by `JSON.stringify(input)` because the fingerprint
 * has to mean the same thing across deployments: object key order is stable
 * enough in practice and is not a promise, an added field would silently
 * invalidate every stored hash, and `otherGeneratedBiographies` must stay out.
 * Writing the fields out is what makes adding one to the prompt a decision about
 * whether the roster should be redrafted.
 */
function canonical(input: PlayerBiographyInput): string {
    const events = (list: readonly { name: string; year: number }[]) =>
        list.map((event) => `${event.year}:${event.name}`).join('|')

    return [
        `v=${PROMPT_VERSION}`,
        `name=${input.name}`,
        `gender=${input.gender}`,
        `club=${input.homeClub}`,
        `retired=${input.retired}`,
        `misc=${input.miscellaneousDetails.join('|')}`,
        `appearances=${events(input.previousAppearances)}`,
        `hector=${events(input.hectorWins)}`,
        `victor=${events(input.victorWins)}`,
        `past=${events(input.allPastEvents)}`,
        `next=${input.nextEvent ? `${input.nextEvent.year}:${input.nextEvent.name}:${input.nextEvent.participates}` : 'none'}`,
    ].join('\n')
}

/**
 * The fingerprint stored beside a biography, and compared on the next run.
 *
 * Truncated to 16 hex characters. The whole digest would be 64, and what this
 * has to survive is 45 players against their own previous value — not an
 * adversary looking for a collision. A collision here would mean one biography
 * silently considered current when it is not, which is the failure mode the
 * length is chosen against: 64 bits is far past the point where that is worth
 * another thought.
 */
export function promptFingerprint(input: PlayerBiographyInput): string {
    return createHash('sha256').update(canonical(input)).digest('hex').slice(0, 16)
}
