import { describe, expect, it } from 'vitest'

import { guard } from '../src/lib/jobs/backup.ts'

/**
 * The append-only guard, which is what makes the file in git a backup rather
 * than a mirror of whatever Firestore currently says.
 */

const file = (...lines: string[]) => (lines.length === 0 ? '' : `${lines.join('\n')}\n`)

describe('committing a rendered backup', () => {
    it('says nothing to do when the render matches what is committed', () => {
        const same = file('{"a":1}', '{"b":2}')
        expect(guard(same, same)).toEqual({ verdict: 'unchanged' })
    })

    it('allows lines appended to the end', () => {
        expect(guard(file('{"a":1}'), file('{"a":1}', '{"b":2}'))).toEqual({ verdict: 'append', added: 1 })
    })

    it('allows the very first write, when there is no file yet', () => {
        expect(guard(undefined, file('{"a":1}'))).toEqual({ verdict: 'append', added: 1 })
    })

    it('refuses a render that drops a committed line', () => {
        const verdict = guard(file('{"a":1}', '{"b":2}'), file('{"a":1}'))
        expect(verdict.verdict).toBe('refuse')
    })

    it('refuses a render that edits a committed line', () => {
        // The case that matters most: a handicap silently corrected in place is
        // indistinguishable from a handicap that was always that value, unless
        // something refuses to write it.
        const verdict = guard(file('{"handicap":14.7}'), file('{"handicap":99.9}'))
        expect(verdict).toEqual({
            verdict: 'refuse',
            detail: 'line 1 of the committed file would be rewritten, and history is append-only',
        })
    })

    it('refuses a reordering, even though nothing was lost', () => {
        // Stricter than "is a superset", deliberately: a render whose order is
        // unstable is a bug that would otherwise surface as a whole-file diff
        // nobody reads.
        const verdict = guard(file('{"a":1}', '{"b":2}'), file('{"b":2}', '{"a":1}'))
        expect(verdict.verdict).toBe('refuse')
    })

    it('keeps the offending content out of the message', () => {
        // These lines are observations about named people and the detail is
        // rendered on the Operations page. The line number is the actionable
        // half; the content is in the commit that was refused.
        const verdict = guard(file('{"player":"lasse-k","handicap":14.7}'), file('{"player":"lasse-k","handicap":9.9}'))
        expect(verdict.verdict === 'refuse' && verdict.detail).not.toContain('lasse-k')
    })

    it('does not care whether the committed file ended with a newline', () => {
        expect(guard('{"a":1}', file('{"a":1}', '{"b":2}'))).toEqual({ verdict: 'append', added: 1 })
    })

    it('refuses a blank line appearing mid-file rather than skipping past it', () => {
        const verdict = guard(file('{"a":1}', '{"b":2}'), file('{"a":1}', '', '{"b":2}'))
        expect(verdict.verdict).toBe('refuse')
    })

    it('treats a render that truncates everything as the emergency it is', () => {
        // The shape of the accident this exists for: Firestore comes back empty,
        // the render is empty, and without the guard the next commit deletes two
        // and a half years of observations.
        const verdict = guard(file('{"a":1}', '{"b":2}'), '')
        expect(verdict).toEqual({
            verdict: 'refuse',
            detail: 'the render has 2 fewer lines than the committed file',
        })
    })
})
