import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Importing `update-player-biographies.ts` must not touch the working tree.
 *
 * `golfClubs` was a module-level IIFE: it scraped WiseGolf and wrote the answer
 * over `src/data/clubs.json` while the module was still evaluating. A test run
 * has no WiseGolf credentials, so the answer was nothing, and the file — 1,402
 * lines of committed club data — came back as `[]`. Nothing threw, nothing
 * logged, and the suite went green. The damage showed up later as an unexplained
 * deletion in `git status`, which is exactly the kind of thing that gets
 * committed by somebody who is not looking.
 *
 * That is the whole reason this file exists rather than a general "workflows are
 * importable" rule. The failure was silent, so the guard has to be an assertion
 * rather than a habit.
 *
 * Deliberately **not** importing the module at the top of this file: a static
 * import is hoisted and would run before the first read below, which would
 * compare the damaged file against itself and pass. The import is inside the
 * test, after the bytes are in hand.
 *
 * The three other scripts under `src/workflows/` still call their `run()` at
 * module scope and are still unsafe to import. They are not covered here because
 * making them pass is a change to them, not to this test.
 */

const ROOT = join(import.meta.dirname, '../..')
const CLUBS_JSON = join(ROOT, 'src/data/clubs.json')
const COMMIT_MESSAGE = join(ROOT, '.update-player-biographies-commit')

describe('importing the biography workflow', () => {
    it('leaves clubs.json byte for byte as it found it', async () => {
        const before = readFileSync(CLUBS_JSON, 'utf-8')

        // Guard the guard. If this file ever stopped being the committed club
        // list, the comparison below would hold trivially and say nothing.
        const clubs = JSON.parse(before)
        expect(Array.isArray(clubs)).toBe(true)
        expect(clubs.length).toBeGreaterThan(100)

        await import('../../src/workflows/update-player-biographies')

        expect(readFileSync(CLUBS_JSON, 'utf-8')).toBe(before)
    })

    it('does not reset the commit message file either', async () => {
        // The other import-time write, and the one that gives the game away in a
        // dirty checkout: the module used to `rmSync` this file and recreate it
        // empty at module scope, throwing away a message a real run had left for
        // `commit-changes.sh`. It is gitignored, so unlike `clubs.json` it would
        // never have shown up in a diff.
        const before = existsSync(COMMIT_MESSAGE) ? readFileSync(COMMIT_MESSAGE, 'utf-8') : null

        await import('../../src/workflows/update-player-biographies')

        const after = existsSync(COMMIT_MESSAGE) ? readFileSync(COMMIT_MESSAGE, 'utf-8') : null
        expect(after).toBe(before)
    })

    it('still hands over the function the tests import it for', async () => {
        // Import safety is worth nothing if it was bought by exporting nothing.
        const module = await import('../../src/workflows/update-player-biographies')
        expect(typeof module.biographiesToRegenerate).toBe('function')
    })
})
