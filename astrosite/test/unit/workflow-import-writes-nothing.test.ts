import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Importing anything under `src/workflows/` must not touch the working tree.
 *
 * `golfClubs` in `update-player-biographies.ts` was a module-level IIFE: it
 * scraped WiseGolf and wrote the answer over `src/data/clubs.json` while the
 * module was still evaluating. A test run has no WiseGolf credentials, so the
 * answer was nothing, and the file — 1,402 lines of committed club data — came
 * back as `[]`. Nothing threw, nothing logged, and the suite went green. The
 * damage showed up later as an unexplained deletion in `git status`, which is
 * exactly the kind of thing that gets committed by somebody who is not looking.
 *
 * That silence is why this is an assertion rather than a habit, and it was never
 * particular to the biography script. All four scripts called their `run()` at
 * module scope; three of them also rewrite committed JSON, and the fourth pushes
 * a commit to GitHub. Any of them would have done that on the first import.
 *
 * Two guards, because neither catches the other's failure:
 *
 * - The **behavioural** one below imports each script and compares every file
 *   the scripts can write, byte for byte. It catches a side effect whatever
 *   shape it is in — an IIFE, a memoised const, a `run()` at the bottom.
 * - The **structural** one reads the sources and rejects a bare top-level call.
 *   It catches the one thing the behavioural check cannot: a write that needs
 *   credentials this machine does not have. A guardless `run()` that dies at the
 *   login it cannot make leaves the tree clean and looks like a pass.
 *
 * Deliberately **not** importing the modules at the top of this file: a static
 * import is hoisted and would run before the first snapshot below, which would
 * compare the damaged tree against itself and pass. Every import is inside a
 * test, after the bytes are in hand.
 */

const ROOT = join(import.meta.dirname, '../..')
const WORKFLOWS = join(ROOT, 'src/workflows')
const DATA = join(ROOT, 'src/data')

/**
 * The scripts, and the commit-message sidecar each one resets when it runs.
 *
 * The sidecars are gitignored, so unlike the JSON under `src/data/` they would
 * never show up in a diff — an import that reset one silently threw away a
 * message a real run had left for `commit-changes.sh`. `update-leaderboards.ts`
 * has none: it commits through the GitHub API rather than through the tree.
 */
const SCRIPTS = [
    ['update-handicaps', '.update-handicaps-commit'],
    ['update-leaderboards', undefined],
    ['update-player-biographies', '.update-player-biographies-commit'],
    ['update-player-club-memberships', '.update-player-club-memberships-commit'],
] as const

/** Every file under a directory, recursively. */
function files(directory: string): string[] {
    const entries = readdirSync(directory).map((name) => join(directory, name))
    return entries.flatMap((path) => (statSync(path).isDirectory() ? files(path) : [path]))
}

/** Path and content hash of everything under `src/data/`, as one comparable value. */
function dataTree(): Record<string, string> {
    return Object.fromEntries(
        files(DATA).map((path) => [
            relative(ROOT, path),
            createHash('sha256').update(readFileSync(path)).digest('hex'),
        ])
    )
}

const sidecar = (name: string | undefined): string | null =>
    name && existsSync(join(ROOT, name)) ? readFileSync(join(ROOT, name), 'utf-8') : null

describe('importing a workflow script', () => {
    it('finds the committed data it is meant to be guarding', () => {
        // A path typo here would make every comparison below hold trivially and
        // say nothing. `clubs.json` is named because it is the file that was
        // actually emptied.
        const tree = dataTree()
        expect(Object.keys(tree).length).toBeGreaterThan(50)
        expect(tree['src/data/clubs.json']).toBeDefined()

        const clubs = JSON.parse(readFileSync(join(DATA, 'clubs.json'), 'utf-8'))
        expect(Array.isArray(clubs)).toBe(true)
        expect(clubs.length).toBeGreaterThan(100)
    })

    it.each(SCRIPTS)('leaves src/data byte for byte as it found it: %s', async (script, commitMessage) => {
        const treeBefore = dataTree()
        const sidecarBefore = sidecar(commitMessage)

        await import(`../../src/workflows/${script}.ts`)

        expect(dataTree()).toEqual(treeBefore)
        expect(sidecar(commitMessage)).toBe(sidecarBefore)
    })

    it('still hands over the function the tests import it for', async () => {
        // Import safety is worth nothing if it was bought by exporting nothing.
        const module = await import('../../src/workflows/update-player-biographies')
        expect(typeof module.biographiesToRegenerate).toBe('function')
    })
})

/**
 * A call statement at the very start of a line, i.e. at top level.
 *
 * `run();`, `updateLeaderboardsForAllOngoingTournaments();`, `await run()` and
 * `void run()` all match; anything the `argv[1]` guard wraps is indented and does
 * not. Matched on the line's own indentation rather than by parsing, in the
 * spirit of `no-bundler-only-imports.test.ts`: the thing being forbidden has one
 * shape, and a test that needs a TypeScript parser to explain itself is worse
 * than the rule it enforces.
 */
const TOP_LEVEL_CALL = /^(await |void )?[A-Za-z_$][\w$]*(\.[\w$]+)*\(.*\)[;\s]*$/

describe('the shape of the workflow scripts', () => {
    const scripts = readdirSync(WORKFLOWS)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(WORKFLOWS, name))

    it('finds the tree it is meant to be guarding', () => {
        expect(scripts.length).toBe(SCRIPTS.length)
        for (const [script] of SCRIPTS) {
            expect(scripts.some((path) => path.endsWith(`/${script}.ts`))).toBe(true)
        }
    })

    it.each([
        ['a bare run()', 'run();'],
        ['a named entry point', 'updateLeaderboardsForAllOngoingTournaments();'],
        ['an awaited one', 'await run()'],
    ])('would notice %s', (_label, line) => {
        // The guard, guarded. A regex that matched nothing would pass this file
        // silently for as long as nobody looked.
        expect(TOP_LEVEL_CALL.test(line)).toBe(true)
    })

    it.each([
        ['the guarded call', '    run();'],
        ['a declaration', 'const run = async () => {'],
        ['the guard itself', 'if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {'],
    ])('does not trip on %s', (_label, line) => {
        expect(TOP_LEVEL_CALL.test(line)).toBe(false)
    })

    it('starts no work at import time', () => {
        const offenders = scripts
            .flatMap((path) =>
                readFileSync(path, 'utf-8')
                    .split('\n')
                    .map((line, index) => ({ path, line, number: index + 1 }))
            )
            .filter(({ line }) => TOP_LEVEL_CALL.test(line))
            .map(({ path, line, number }) => `${relative(ROOT, path)}:${number}  ${line.trim()}`)

        expect(
            offenders,
            'Put the call behind `if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))`, ' +
                'so that importing the module does not start the job.'
        ).toEqual([])
    })
})
