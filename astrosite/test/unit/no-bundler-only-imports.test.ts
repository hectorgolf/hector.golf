import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Nothing the workflows can reach may use bundler-only import syntax.
 *
 * This exists because of a six-hour outage nobody noticed. `handicaps.ts` was
 * given `import backup from "…/observations.ndjson?raw"`, which is Vite syntax:
 * it inlines the file at build time, reads beautifully, and works in `astro
 * build` and in vitest, because both are Vite. `update-handicaps.yml` ran
 * `src/workflows/update-handicaps.ts` through `npx tsx` with no bundler in
 * sight, and Node answered `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension
 * ".ndjson"`. The scrape died on the next tick.
 *
 * That particular workflow has since moved into the admin service and its script
 * is gone, but the shape of the mistake has not: three scrapes still run this way
 * and `src/code/` is shared with them.
 *
 * Every check that could have caught it ran under Vite. `astro check` passed,
 * the whole suite passed, the site built 328 pages. The one caller that does not
 * use a bundler is the one nobody runs locally.
 *
 * So the rule is structural rather than remembered: `src/code/` and
 * `src/workflows/` are the trees `tsx` walks, and they get plain ESM. Pages and
 * components are Astro's alone and may use whatever Vite offers —
 * `src/pages/brand.astro` reads a stylesheet with `?raw` quite legitimately.
 */

const ROOT = join(import.meta.dirname, '../..')

/** Every `.ts` under a directory, recursively. */
function sources(directory: string): string[] {
    const entries = readdirSync(directory).map((name) => join(directory, name))
    return entries.flatMap((path) =>
        statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
    )
}

/**
 * Vite-only syntax in an import specifier.
 *
 * `?raw`, `?url`, `?inline` and `?worker` are the ones Vite documents and the
 * ones somebody would reach for. Matched on the specifier rather than anywhere
 * in the line, so that a comment discussing `?raw` — like the one in
 * `admin-api.ts` explaining why it is not used — does not trip this.
 */
const BUNDLER_ONLY = /\bfrom\s+["'][^"']*\?(raw|url|inline|worker)\b[^"']*["']/

describe('what the workflows can import', () => {
    const reachable = [...sources(join(ROOT, 'src/code')), ...sources(join(ROOT, 'src/workflows'))]

    it('finds the trees it is meant to be guarding', () => {
        // A path typo here would make every assertion below vacuous.
        expect(reachable.length).toBeGreaterThan(10)
        expect(reachable.some((path) => path.endsWith('code/handicaps.ts'))).toBe(true)
        expect(reachable.some((path) => path.endsWith('workflows/update-leaderboards.ts'))).toBe(true)
    })

    it.each([
        ['?raw', 'import backup from "../../../data/handicaps/observations.ndjson?raw";'],
        ['?url', 'import asset from "./thing.png?url";'],
    ])('would notice a %s import', (_label, line) => {
        // The guard, guarded. A regex that matched nothing would pass this file
        // silently for as long as nobody looked.
        expect(BUNDLER_ONLY.test(line)).toBe(true)
    })

    it('does not trip on prose that merely mentions the syntax', () => {
        expect(BUNDLER_ONLY.test(' * `?raw` rather than `node:fs`, so that the module stays isomorphic.')).toBe(false)
    })

    it('uses none of it under src/code or src/workflows', () => {
        const offenders = reachable
            .flatMap((path) =>
                readFileSync(path, 'utf-8')
                    .split('\n')
                    .map((line, index) => ({ path, line, number: index + 1 }))
            )
            .filter(({ line }) => BUNDLER_ONLY.test(line))
            .map(({ path, line, number }) => `${path.slice(ROOT.length + 1)}:${number}  ${line.trim()}`)

        expect(
            offenders,
            'These run under `npx tsx` in a workflow, where Vite is not there to resolve them.'
        ).toEqual([])
    })
})
