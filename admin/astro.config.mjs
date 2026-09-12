import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

// Server output, not static: this app reads Firestore per request and renders
// what is there now. That is the whole reason it exists rather than being more
// pages on the static site.
export default defineConfig({
    output: 'server',
    // 'standalone' builds its own HTTP server, which is what the container runs.
    // The alternative, 'middleware', expects to be mounted inside someone else's.
    adapter: node({ mode: 'standalone' }),
    security: {
        // Cloud Run terminates TLS and forwards plain HTTP to the container, so
        // the only evidence of the address the browser actually used is the Host
        // header and X-Forwarded-Proto. Astro ignores both unless the host is
        // listed here — without this it builds Astro.url as http://localhost:8080,
        // which never matches the browser's Origin header, so its CSRF check
        // rejects every form POST with "Cross-site POST form submissions are
        // forbidden". Listing the hosts this service answers on is what makes
        // that check compare like with like; it stays on.
        allowedDomains: [
            // The service's own run.app URL, whose subdomain Google generates.
            { hostname: '**.a.run.app', protocol: 'https' },
            // The custom domain, once terraform's admin_domain maps one.
            { hostname: '**.hector.golf', protocol: 'https' },
        ],
    },
    vite: {
        ssr: {
            // @hector/ui ships .astro sources rather than built output, so Vite
            // has to compile it instead of treating it as an external dependency.
            noExternal: ['@hector/ui'],
        },
    },
})
