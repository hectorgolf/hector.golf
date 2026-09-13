import { defineConfig } from "vitest/config";

/**
 * Three suites, because there are three different questions worth asking about a
 * Cloud Function and they cost wildly different amounts to answer:
 *
 * - `unit` imports a module and calls it. No HTTP, no framework, no build. This is
 *   where the fiddly logic belongs — payload validation, ordinals, prompt assembly —
 *   so that the expensive suites do not have to enumerate every edge case.
 *
 * - `functions` drives the exported handler over real HTTP through the Functions
 *   Framework's own Express server, so request parsing, `request.header()`,
 *   `request.query`, status codes and response headers are the real thing. The
 *   modules are imported from `src/`, so there is no build step and watch mode works.
 *
 * - `deployment` builds `dist/` and then starts the Functions Framework as a separate
 *   process against it, resolving the entry point exactly the way `gcloud functions
 *   deploy --entry-point=...` will. It is the suite that answers "does the thing we
 *   are about to deploy actually load and serve?", so it is also the slow one.
 *
 * `npm test` runs all three. `npm run test:unit` (etc.) runs one.
 */
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "unit",
                    environment: "node",
                    include: ["test/unit/**/*.test.ts"],
                },
            },
            {
                test: {
                    name: "functions",
                    environment: "node",
                    include: ["test/functions/**/*.test.ts"],
                },
            },
            {
                test: {
                    name: "deployment",
                    environment: "node",
                    include: ["test/deployment/**/*.test.ts"],
                    // Compiling once for the whole suite, not once per file.
                    globalSetup: ["test/support/build-dist.ts"],
                    // Starting a server per entry point is slower than an import.
                    testTimeout: 30_000,
                    hookTimeout: 60_000,
                },
            },
        ],
    },
});
