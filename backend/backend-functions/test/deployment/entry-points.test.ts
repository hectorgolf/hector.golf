import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { packageRoot, startDeployedFunction, type DeployedFunction } from "../support/deployed-function";

/**
 * "Will it work once deployed?" is a different question from "does the handler do the
 * right thing", and no amount of importing a module in-process answers it. A deploy can
 * fail for reasons the other suites cannot see:
 *
 *   - `--entry-point=X` names an export that got renamed, or was never re-exported from
 *     `src/functions/index.ts`
 *   - `package.json`'s `main` points somewhere `tsc` does not write
 *   - the compiled JavaScript throws on load, because a dependency is in
 *     devDependencies and Cloud Functions prunes those
 *   - a `--source=dist/...` path in a `start:`/`dev:` script drifted from the layout
 *
 * So this suite builds `dist/` (see `test/support/build-dist.ts`) and then starts the
 * actual Functions Framework CLI against it, once per entry point the deploy scripts
 * name, resolving the entry point exactly the way Google's runtime will. If it serves
 * here, the same artifact serves there.
 *
 * Nothing in here reaches the network or GCP, and the functions run with a deliberately
 * bare environment, so a real API key on a developer's machine cannot change the result.
 */
type PackageJson = {
    main: string;
    scripts: Record<string, string>;
};

const packageJson: PackageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));

const flagValue = (script: string, flag: string): string | undefined =>
    script.match(new RegExp(`${flag}=([^\\s]+)`))?.[1];

/** Every `--entry-point` a `deploy:` script hands to `gcloud`. */
const deployedEntryPoints = Object.entries(packageJson.scripts)
    .filter(([name, script]) => name.startsWith("deploy:") && script.includes("gcloud functions deploy"))
    .map(([name, script]) => ({
        script: name,
        entryPoint: flagValue(script, "--entry-point"),
        source: flagValue(script, "--source") ?? ".",
    }));

/** Every `--source` a local `start:`/`dev:` script expects `tsc` to have written. */
const localSources = Object.entries(packageJson.scripts)
    .filter(([name]) => name.startsWith("start:") || name.startsWith("dev:"))
    .map(([name, script]) => ({
        script: name,
        target: flagValue(script, "--target"),
        source: flagValue(script, "--source"),
    }));

/**
 * Placeholders. They are never sent anywhere: every request below is turned away by the
 * function before it would reach Gemini or app.hector.golf, which is what makes these
 * assertions safe to run against a real server.
 */
const configured = {
    GOOGLE_GEMINI_API_KEY: "deployment-test-gemini-key",
    ASTROSITE_API_KEY: "deployment-test-site-key",
    HECTOR_APP_API_KEY: "deployment-test-app-key",
};

/**
 * One request per function that proves the deployed thing is really that function and
 * not merely *a* server: each is answered from the handler's own guard clauses, before
 * any upstream call.
 */
const behaviours: Record<string, { description: string; call: (fn: DeployedFunction) => Promise<Response> }> = {
    ExtractScorecardInformation: {
        description: "asks an unauthenticated caller for an API key",
        call: (fn) => fn.fetch("/", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    },
    GeneratePlayerBiography: {
        description: "asks an unauthenticated caller for an API key",
        call: (fn) => fn.fetch("/", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    },
    GeneratePlayerAvatar: {
        description: "asks an unauthenticated caller for an API key",
        call: (fn) => fn.fetch("/", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    },
    TournamentLeaderboard: {
        description: "turns down a request that names no event",
        call: (fn) => fn.fetch("/"),
    },
};

const expectedStatus: Record<string, number> = {
    ExtractScorecardInformation: 401,
    GeneratePlayerBiography: 401,
    GeneratePlayerAvatar: 401,
    TournamentLeaderboard: 400,
};

describe("the artifact a deploy would upload", () => {
    let running: DeployedFunction | undefined;

    afterEach(async () => {
        await running?.stop();
        running = undefined;
    });

    it("has deploy scripts to check in the first place", () => {
        // Guards against this whole suite quietly passing because a regex stopped matching.
        expect(deployedEntryPoints.length).toBeGreaterThan(0);
        expect(deployedEntryPoints.every((entry) => entry.entryPoint)).toBe(true);
    });

    it("is where package.json says it is", () => {
        // `gcloud functions deploy --source=.` uploads the package and the runtime loads
        // `main`, so this file existing after `gcp-build` is the deploy's first premise.
        expect(existsSync(resolve(packageRoot, packageJson.main))).toBe(true);
    });

    describe.each(deployedEntryPoints)("$entryPoint (from $script)", ({ entryPoint, source }) => {
        it("loads and serves, resolved by name the way gcloud resolves it", async () => {
            running = await startDeployedFunction({ target: entryPoint!, source, env: configured });

            const response = await running.fetch("/", { method: "OPTIONS" });

            expect(response.status).toBeLessThan(500);
            expect(running.output()).not.toContain("Could not load the function");
        });

        it(behaviours[entryPoint!]?.description ?? "answers a request", async () => {
            const behaviour = behaviours[entryPoint!];
            if (!behaviour) {
                // A new function without an expectation here still gets the smoke test
                // above; this only skips the specific one nobody has written yet.
                return;
            }

            running = await startDeployedFunction({ target: entryPoint!, source, env: configured });

            const response = await behaviour.call(running);

            expect(response.status).toBe(expectedStatus[entryPoint!]);
        });
    });

    it("refuses to serve an entry point that does not exist, which is what a typo looks like", async () => {
        // Proves the test above is actually capable of failing: the framework exits
        // rather than serving, and `startDeployedFunction` reports it.
        await expect(startDeployedFunction({ target: "NoSuchFunction", env: configured })).rejects.toThrow(
            /could not serve 'NoSuchFunction'/i,
        );
    });

    describe.each(localSources)("$script", ({ source }) => {
        it("points at a file tsc actually writes", () => {
            expect(source, "the script has no --source flag").toBeDefined();
            expect(existsSync(resolve(packageRoot, source!))).toBe(true);
        });
    });
});
