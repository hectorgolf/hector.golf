import { describe, expect, it } from 'vitest'

import { guard } from '../src/lib/jobs/backup.ts'
import { appendOnly, wholesale } from '../src/lib/jobs/registry.ts'

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

/**
 * The two rules a commit can be made under, and why there are two.
 *
 * `appendOnly` is the guard above: the file *is* its history, so a rewrite
 * destroys the only copy of what it used to say and nothing can recover it.
 *
 * `wholesale` is for a file whose previous versions live in git — an event's
 * JSON, which the bucket recompute rewrites in full. A bad write there is a
 * revert, which is the whole reason `data-ownership.md` gives for the repository
 * being the database. Applying the guard to it would refuse every recompute that
 * moved a player between buckets, which is the only thing a recompute does.
 */
describe('the rule a commit is made under', () => {
    const before = file('{"a":1}', '{"b":2}')

    describe('appendOnly', () => {
        it('writes when the render only adds', () => {
            expect(appendOnly(file('{"a":1}', '{"b":2}', '{"c":3}'), 'x.ndjson')(before)).toEqual({
                write: file('{"a":1}', '{"b":2}', '{"c":3}'),
            })
        })

        it('skips an identical render rather than making an empty commit', () => {
            expect(appendOnly(before, 'x.ndjson')(before)).toEqual({ skip: true })
        })

        it('refuses a rewrite', () => {
            const decision = appendOnly(file('{"a":1}', '{"b":99}'), 'x.ndjson')(before)
            expect(decision).toHaveProperty('refuse')
        })
    })

    describe('wholesale', () => {
        it('writes whatever it is given, including the rewrite appendOnly refuses', () => {
            const rewritten = file('{"a":1}', '{"b":99}')
            expect(wholesale(rewritten)(before)).toEqual({ write: rewritten })
        })

        it('writes a shorter file, which is a split losing a participant', () => {
            const shorter = file('{"a":1}')
            expect(wholesale(shorter)(before)).toEqual({ write: shorter })
        })

        it('skips identical text, so an unchanged split costs no commit', () => {
            expect(wholesale(before)(before)).toEqual({ skip: true })
        })

        it('writes the first version when there is no file yet', () => {
            expect(wholesale(before)(undefined)).toEqual({ write: before })
        })
    })
})
