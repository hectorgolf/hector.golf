import { describe, expect, it, vi } from 'vitest'

import { credentialsFrom, loadHandicapHistory, parseHistory } from '../../src/code/handicap-history-source'

/**
 * Where the site build gets its handicaps, and — the part worth testing — what it
 * does when it cannot.
 *
 * Step 3 of `docs/plans/handicaps-to-firestore.md` states the rule as an
 * asymmetry: a build with no credentials reads the committed backup and says so,
 * a build *with* credentials that cannot reach the API fails. Every failure mode
 * here is silent by nature — a stale handicap looks exactly like a current one on
 * a rendered page — so the branches are pinned rather than described.
 */

const ndjson =
    '{"date":"2026-09-16","player":"lauri-p","handicap":12}\n' +
    '{"date":"2026-09-18","player":"sami-h","handicap":5.2,"observed":"2026-09-18T05:00:35Z"}\n'

const credentials = { HANDICAP_HISTORY_URL: 'https://admin.example/api/handicaps/history', HANDICAP_HISTORY_TOKEN: 'id-token' }

const ok = (body: string) => new Response(body, { status: 200 })

describe('reading the NDJSON', () => {
    it('parses one entry per line and validates every one', () => {
        expect(parseHistory(ndjson)).toEqual([
            { date: '2026-09-16', player: 'lauri-p', handicap: 12 },
            { date: '2026-09-18', player: 'sami-h', handicap: 5.2, observed: '2026-09-18T05:00:35Z' },
        ])
    })

    it('ignores blank lines rather than failing on a trailing newline', () => {
        expect(parseHistory('\n' + ndjson + '\n\n')).toHaveLength(2)
    })

    it('reads an empty body as an empty history rather than throwing', () => {
        expect(parseHistory('')).toEqual([])
    })

    it('throws on a row that is not an observation, rather than passing it on', () => {
        // The validation is the reason `handicaps.ts` no longer parses per player.
        // If it stopped happening here it would stop happening at all.
        expect(() => parseHistory('{"player":"sami-h"}\n')).toThrow()
    })
})

describe('deciding whether this build has credentials', () => {
    it('is nothing when neither is set, which is a fork or a laptop', () => {
        expect(credentialsFrom({})).toBeUndefined()
        expect(credentialsFrom({ HANDICAP_HISTORY_URL: '  ', HANDICAP_HISTORY_TOKEN: '' })).toBeUndefined()
    })

    it('is both when both are set', () => {
        expect(credentialsFrom(credentials)).toEqual({
            url: 'https://admin.example/api/handicaps/history',
            token: 'id-token',
        })
    })

    /*
     * Half-configured is a failure, not a fallback. Setting one of these is a
     * statement that somebody wired this deploy to the API, and answering a typo
     * with the committed backup is the silent stale publish this file exists to
     * prevent — arrived at by a misspelled variable name instead of an outage.
     */
    it('refuses a half-configured build rather than quietly using the backup', () => {
        expect(() => credentialsFrom({ HANDICAP_HISTORY_URL: 'https://admin.example/x' })).toThrow(/together/)
        expect(() => credentialsFrom({ HANDICAP_HISTORY_TOKEN: 'id-token' })).toThrow(/together/)
    })
})

describe('a build with no credentials', () => {
    it('uses the committed backup and never calls the network', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()

        const history = await loadHandicapHistory({ env: {}, fetch, backup: ndjson, notify: () => {} })

        expect(history).toHaveLength(2)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('says so, loudly enough to find in a build log', async () => {
        const notify = vi.fn()
        await loadHandicapHistory({ env: {}, backup: ndjson, notify })

        expect(notify).toHaveBeenCalledOnce()
        const said = String(notify.mock.calls[0]![0])
        // Names the file, so a reader can go and look at what was used, and says
        // it may be stale, which is the whole content of the warning.
        expect(said).toContain('data/handicaps/observations.ndjson')
        expect(said).toMatch(/not necessarily today/)
    })

    it('is a supported way to build, not a degraded one', async () => {
        // The `data-ownership.md` promise: a fork can still build the site. If
        // this ever throws, that promise is broken for everybody without access
        // to the admin service.
        await expect(loadHandicapHistory({ env: {}, backup: ndjson, notify: () => {} })).resolves.toHaveLength(2)
    })
})

describe('a build with credentials', () => {
    it('asks the endpoint, carrying the ID token IAP wants', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok(ndjson))

        const history = await loadHandicapHistory({ env: credentials, fetch, backup: '', notify: () => {} })

        expect(history).toHaveLength(2)
        const [url, init] = fetch.mock.calls[0]!
        expect(url).toBe('https://admin.example/api/handicaps/history')
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer id-token')
    })

    it('prefers the endpoint over the backup when both could answer', async () => {
        // The backup here says something different on purpose: a build that
        // silently used it would pass a test that only counted rows.
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok(ndjson))
        const stale = '{"date":"2020-01-01","player":"sami-h","handicap":36}\n'

        const history = await loadHandicapHistory({ env: credentials, fetch, backup: stale, notify: () => {} })

        expect(history.map((entry) => entry.date)).not.toContain('2020-01-01')
    })

    /*
     * The asymmetry the plan is emphatic about. There is deliberately no branch
     * where credentials are present, the fetch fails, and the backup is used
     * anyway — that is the behaviour everybody reaches for, and it is what
     * publishes a week-old handicap on the morning of a Draft.
     */
    it('fails the build when the endpoint refuses, rather than falling back', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('nope', { status: 503 }))

        await expect(
            loadHandicapHistory({ env: credentials, fetch, backup: ndjson, notify: () => {} })
        ).rejects.toThrow(/503/)
    })

    it('fails the build when the endpoint cannot be reached at all', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('ECONNREFUSED'))

        await expect(
            loadHandicapHistory({ env: credentials, fetch, backup: ndjson, notify: () => {} })
        ).rejects.toThrow(/Could not reach/)
    })

    /*
     * An empty answer is a success at the endpoint and a failure here, and the
     * two are not in conflict: the endpoint cannot tell an empty store from one
     * nobody has filled yet, and a build of this site can. A deploy rendering
     * every player with no handicap is the worst outcome available to any of
     * this — the plan's own post-mortem records a successful build that produced
     * 77 pages instead of 328 with nothing in the toolchain objecting.
     */
    it('refuses to publish a site with no handicaps at all', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok(''))

        await expect(
            loadHandicapHistory({ env: credentials, fetch, backup: ndjson, notify: () => {} })
        ).rejects.toThrow(/empty/)
    })
})
