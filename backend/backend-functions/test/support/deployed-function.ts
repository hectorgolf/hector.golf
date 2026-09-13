import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package root, i.e. the directory `gcloud functions deploy --source=.` uploads. */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The Functions Framework's own CLI, which is also what the Cloud Functions Node.js
 * runtime starts your code with. Running the real binary rather than importing a
 * handler is the entire point of this helper: it exercises the module resolution
 * (`require.resolve(sourceLocation)`, which lands on `package.json`'s `main`), the
 * entry-point lookup by name, and the compiled JavaScript in `dist/` — the three things
 * a deploy can get wrong that no in-process test would ever notice.
 */
const frameworkCli = resolve(packageRoot, "node_modules", ".bin", "functions-framework");

/** A port nobody is listening on. Small race, but the alternative is a hardcoded guess. */
const freePort = (): Promise<number> =>
    new Promise((resolvePort, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => resolvePort(port));
        });
    });

export type DeployedFunction = {
    readonly url: string;
    /** Everything the framework wrote to stdout and stderr, for when a load fails. */
    readonly output: () => string;
    fetch(path: string, init?: RequestInit): Promise<Response>;
    stop(): Promise<void>;
};

export type DeployedFunctionOptions = {
    /** The `--entry-point` a deploy script names. */
    target: string;
    /** The `--source` to load it from. Defaults to the package itself, as a deploy does. */
    source?: string;
    /** Environment for the function, on top of a deliberately bare baseline. */
    env?: Record<string, string>;
    /** How long to wait for the server to come up. */
    timeoutMs?: number;
};

export const startDeployedFunction = async ({
    target,
    source = ".",
    env = {},
    timeoutMs = 20_000,
}: DeployedFunctionOptions): Promise<DeployedFunction> => {
    const port = await freePort();

    // A bare environment on purpose. Inheriting the developer's shell would mean a real
    // GOOGLE_GEMINI_API_KEY could decide whether a test passes, and these tests must
    // behave the same on a laptop and on a CI runner that has never heard of Gemini.
    const child = spawn(
        process.execPath,
        [frameworkCli, `--target=${target}`, `--source=${source}`, `--port=${port}`, "--signature-type=http"],
        {
            cwd: packageRoot,
            env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));

    let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    child.once("exit", (code, signal) => (exited = { code, signal }));

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (exited) {
            throw new Error(
                `The Functions Framework could not serve '${target}' from '${source}'. ` +
                    `It exited with ${exited.signal ?? exited.code}.\n\n${output}`,
            );
        }
        try {
            // Any answer at all means the module loaded and the server is up; what the
            // function makes of this particular request is the test's business.
            await fetch(`${url}/`, { method: "OPTIONS", signal: AbortSignal.timeout(1_000) });
            break;
        } catch {
            if (Date.now() > deadline) {
                child.kill("SIGKILL");
                throw new Error(`'${target}' did not start serving within ${timeoutMs}ms.\n\n${output}`);
            }
            await new Promise((wait) => setTimeout(wait, 50));
        }
    }

    return {
        url,
        output: () => output,
        fetch: (path, init) => fetch(new URL(path, url), init),
        stop: () =>
            new Promise<void>((resolveStop) => {
                if (exited) return resolveStop();
                child.once("exit", () => resolveStop());
                child.kill("SIGTERM");
            }),
    };
};
