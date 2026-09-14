import { createRequest } from 'astro/app/node'
import { readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'

import config from '../astro.config.mjs'

/**
 * Astro's CSRF check compares the browser's Origin header with the URL it
 * reconstructs for the request, and refuses a form POST when they differ. Behind
 * Cloud Run the container is spoken to over plain HTTP on localhost, so that
 * reconstruction is only right if Astro is told to trust the Host header and
 * X-Forwarded-Proto — which it does only for the hosts `security.allowedDomains`
 * lists. Get that list wrong and every form in the admin dies with "Cross-site
 * POST form submissions are forbidden", which is not an error anyone would trace
 * back to a config file, so it is worth a test against the real Astro.
 */
const allowedDomains = config.security?.allowedDomains

/** A Cloud Run request as the container sees it: TLS already terminated. */
const proxiedRequest = (host: string, forwardedProto = 'https') =>
    createRequest(
        {
            method: 'POST',
            url: '/events/matchplay/HECTORMATCHPLAY2024/edit',
            headers: {
                host,
                origin: `https://${host}`,
                'x-forwarded-proto': forwardedProto,
                'content-type': 'application/x-www-form-urlencoded',
            },
            socket: { remoteAddress: '169.254.1.1' },
        } as unknown as IncomingMessage,
        { allowedDomains, port: 8080, skipBody: true },
    )

const originOf = (request: Request) => new URL(request.url).origin

describe('the address Astro thinks a request arrived at', () => {
    it('is the run.app URL the browser used, whatever subdomain Google generated', () => {
        const host = 'hector-admin-6uxopx7tjq-lz.a.run.app'
        expect(originOf(proxiedRequest(host))).toBe(`https://${host}`)
    })

    it('is the custom domain, for when terraform maps one', () => {
        expect(originOf(proxiedRequest('admin.hector.golf'))).toBe('https://admin.hector.golf')
    })

    it('ignores a Host header from somewhere else, so the allowlist is still an allowlist', () => {
        // Not trusted, so Astro keeps its own address — and a POST claiming to
        // come from evil.example.com fails the origin check rather than being
        // handed an Astro.url of the attacker's choosing.
        expect(originOf(proxiedRequest('evil.example.com'))).toBe('https://localhost:8080')
    })
})

/**
 * The other half of that check, and the half that is easy to get wrong when adding
 * a non-browser caller: which requests it applies to at all.
 *
 * Astro forbids a cross-origin POST carrying a form content type — and one carrying
 * **no** content type, which is not what the rule sounds like and is exactly what
 * `curl` sends when it has no body:
 *
 *     if (hasContentType) { return formLikeHeader && !isSameOrigin }
 *     return !isSameOrigin
 *
 * `.github/actions/request-deploy` was written without one, and every data update's
 * deploy request came back 403 "Cross-site POST form submissions are forbidden"
 * with the scrape itself perfectly healthy. `terraform/scheduler.tf` had always sent
 * JSON and an empty body, which is why the schedule worked and the new caller did
 * not — two callers of the same endpoint, one of which had the knowledge.
 *
 * Asserted against the callers rather than against Astro's predicate, which is not
 * exported. What this can protect is that both of ours keep saying the same thing.
 */
describe('how the non-browser callers ask', () => {
    const repoFile = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8')

    it('has Cloud Scheduler sending JSON', () => {
        const scheduler = repoFile('terraform/scheduler.tf')
        expect(scheduler).toContain('"Content-Type" = "application/json"')
    })

    it('has the deploy request sending JSON', () => {
        const action = repoFile('.github/actions/request-deploy/action.yml')
        expect(action).toContain('-H "Content-Type: application/json"')
    })

    it('has the deploy request accepting the 202 the endpoint returns', () => {
        // The endpoint answers 202: GitHub has accepted the dispatch and does not
        // say which run it created. A caller that only accepts 200 warns on success.
        const action = repoFile('.github/actions/request-deploy/action.yml')
        expect(action).toContain('"$status" = "202"')
    })
})
