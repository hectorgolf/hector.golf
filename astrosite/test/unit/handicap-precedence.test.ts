import { describe, expect, it } from 'vitest'

import { resolveHandicap } from '../../src/code/players'

/**
 * Which handicap wins when a player has both a hand-set one and an official one.
 *
 * The answer is the official one, and it has not always been. While
 * `update-handicaps.ts` wrote the player file, the stored value won and CI
 * retired it within hours by overwriting it — so "stored wins" and "official
 * wins" were the same thing a tick apart. That write went away on 2026-09-18 and
 * they stopped being the same thing: a stopgap would have shadowed an official
 * handicap until some unrelated workflow next rewrote the player, which for the
 * biographies run is a fortnight.
 *
 * These cases used to be guaranteed by a scheduled job. They are now guaranteed
 * by an expression, which is the better place for them.
 */
describe('resolving a handicap', () => {
    it('prefers the official reading over a hand-set one', () => {
        // The regression this exists for: before the flip this answered 36.
        expect(resolveHandicap(5.2, 36)).toBe(5.2)
    })

    it('falls back to the hand-set one when there is no official reading', () => {
        // The stopgap doing the only job it has left.
        expect(resolveHandicap(undefined, 28)).toBe(28)
    })

    it('is undefined when there is neither', () => {
        expect(resolveHandicap(undefined, undefined)).toBeUndefined()
    })

    /*
     * `??` and not `||`. A scratch player's handicap is 0, and 0 is falsy — the
     * original comment records this trap in the other direction, where `||`
     * discarded a stopgap of 0. It discards an official 0 just as happily.
     */
    it('keeps an official scratch handicap rather than falling through to the stopgap', () => {
        expect(resolveHandicap(0, 28)).toBe(0)
    })

    it('keeps a hand-set scratch handicap when there is no official one', () => {
        expect(resolveHandicap(undefined, 0)).toBe(0)
    })
})
