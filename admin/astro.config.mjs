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
    vite: {
        ssr: {
            // @hector/ui ships .astro sources rather than built output, so Vite
            // has to compile it instead of treating it as an external dependency.
            noExternal: ['@hector/ui'],
        },
    },
})
