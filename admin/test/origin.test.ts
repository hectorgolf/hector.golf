import { createRequest } from 'astro/app/node'
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
