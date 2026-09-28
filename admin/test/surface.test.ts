import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PUBLIC_PATHS, isPublicPath, mayServe, servesFullSurface } from '../src/lib/surface.ts'

/**
 * The gate that keeps the admin UI off a service with no IAP in front of it.
 *
 * This is the most load-bearing test in the admin suite, and it is worth saying
 * why in one sentence: if it passes while the thing it describes is broken, the
 * whole admin — every player, every course, every Save button — is served
 * unauthenticated on a public hostname.
 *
 * So it is written to fail when somebody adds a route rather than when somebody
 * remembers to come back here. The last block walks `src/pages/` on disk and
 * asserts that every route it finds is refused unless it is on the list, which
 * means a page added next month is covered by a test written today.
 */

describe('which deployment serves everything', () => {
    it('is opt-in: an unconfigured deployment is the restricted one', () => {
        // The direction that matters. A deployment that loses its environment,
        // or a third service somebody adds in a hurry, must be the safe one.
        expect(servesFullSurface({}, false)).toBe(false)
    })

    it('is not turned on by a near miss', () => {
        for (const value of ['', 'Full', 'FULL', 'true', '1', 'yes', 'admin', ' full']) {
            expect(servesFullSurface({ ADMIN_SURFACE: value }, false), value).toBe(false)
        }
    })

    it('is turned on by exactly the value terraform sets', () => {
        expect(servesFullSurface({ ADMIN_SURFACE: 'full' }, false)).toBe(true)
    })

    it('is on under the dev server, so a laptop serves its own pages', () => {
        expect(servesFullSurface({}, true)).toBe(true)
    })
})

describe('what a restricted deployment serves', () => {
    it('serves the hook, which is the point of it', () => {
        expect(mayServe('/api/hooks/round', false)).toBe(true)
    })

    it('serves the liveness probe, which Cloud Run needs to start it at all', () => {
        expect(mayServe('/livez', false)).toBe(true)
    })

    it('does not serve the readiness probe, which reaches Firestore', () => {
        // Whether this project's database is answering is not a thing to tell
        // the internet.
        expect(mayServe('/readyz', false)).toBe(false)
    })

    it('does not serve the admin UI', () => {
        for (const path of ['/', '/players', '/courses', '/events', '/operations']) {
            expect(mayServe(path, false), path).toBe(false)
        }
    })

    it('does not serve the job and workflow endpoints', () => {
        // These are the ones an attacker would want: they commit, deploy and
        // dispatch. On the admin service IAP stands in front of them.
        for (const path of [
            '/api/jobs/leaderboards/run',
            '/api/jobs/handicaps/run',
            '/api/workflows/dispatch',
            '/api/workflows/deploy/dispatch',
        ]) {
            expect(mayServe(path, false), path).toBe(false)
        }
    })

    it('matches whole paths, not prefixes', () => {
        // A prefix rule on `/api/hooks` would also serve whatever somebody puts
        // beside the hook later, and would invite a traversal that depends on
        // URL normalisation happening somewhere else first.
        for (const path of [
            '/api/hooks',
            '/api/hooks/',
            '/api/hooks/round/',
            '/api/hooks/round/../../jobs/leaderboards/run',
            '/api/hooks/rounds',
            '/api/hooks/roundx',
            '//api/hooks/round',
            '/API/HOOKS/ROUND',
            '/livezz',
            '/livez/',
        ]) {
            expect(mayServe(path, false), path).toBe(false)
        }
    })

    it('serves everything when the surface is full', () => {
        for (const path of ['/', '/players', '/api/jobs/handicaps/run', '/anything/at/all']) {
            expect(mayServe(path, true), path).toBe(true)
        }
    })

    it('keeps the list short enough to read', () => {
        // Not a style rule. Every entry is a route reachable without IAP, so the
        // list growing is the one change here that should never be incidental.
        expect(PUBLIC_PATHS).toEqual(['/livez', '/api/hooks/round'])
    })
})

/**
 * Every route this app actually has, read off disk.
 *
 * Astro maps `src/pages/**` to URLs, so the filesystem is the route table. The
 * point of reading it rather than listing paths by hand is that the test grows
 * on its own: a page added without a thought for this file is refused, and if
 * somebody ever makes it reachable they have to come here and say so.
 */
function routesOnDisk(directory: string, prefix = ''): string[] {
    const routes: string[] = []
    for (const entry of readdirSync(directory)) {
        const full = join(directory, entry)
        if (statSync(full).isDirectory()) {
            routes.push(...routesOnDisk(full, `${prefix}/${entry}`))
            continue
        }
        const name = entry.replace(/\.(astro|ts)$/, '')
        routes.push(name === 'index' ? prefix || '/' : `${prefix}/${name}`)
    }
    return routes
}

describe('every route this app has', () => {
    const routes = routesOnDisk(resolve(import.meta.dirname, '../src/pages'))

    it('was found, so the sweep below is not vacuous', () => {
        expect(routes.length).toBeGreaterThan(15)
        expect(routes).toContain('/api/hooks/round')
        expect(routes).toContain('/livez')
    })

    it('is refused by a restricted deployment unless it is on the list', () => {
        const served = routes.filter((route) => mayServe(route, false))
        expect(served.sort()).toEqual([...PUBLIC_PATHS].sort())
    })

    it('includes dynamic routes, which are refused as their literal path too', () => {
        // `/players/[id]` never arrives spelled that way, but every concrete
        // path it matches is refused for the same reason: it is not on the list.
        expect(routes.some((route) => route.includes('['))).toBe(true)
        for (const route of routes.filter((r) => r.includes('['))) {
            expect(isPublicPath(route), route).toBe(false)
        }
    })
})
