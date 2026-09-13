import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Compiles `src/` into `dist/` once, before the deployment suite runs.
 *
 * The deployment suite's whole point is to exercise the artifact `gcloud functions
 * deploy` would upload, so it has to be built from the current source — a stale `dist/`
 * from yesterday's experiment would make the suite a very convincing lie. This runs the
 * same `tsc` invocation as the `gcp-build` script that Google Cloud runs at deploy time.
 */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default function build(): void {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    execFileSync(process.execPath, [tsc, "--project", "tsconfig.json"], {
        cwd: packageRoot,
        stdio: "inherit",
    });
}
