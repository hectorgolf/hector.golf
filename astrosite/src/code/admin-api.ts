import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the site's scraped data comes from, and the rule for choosing.
 *
 * Steps 3 and 4 of `docs/plans/handicaps-to-firestore.md`. Firestore is the
 * system of record for what the admin service scrapes; the files under `data/`
 * are backups a build without credentials can still read. The plan is emphatic
 * that those are different things — "a backup that is also the build input is not
 * a backup; it is the production path under a misleading name" — so this asks the
 * API when it can and says loudly when it cannot.
 *
 * ## The rule, which is the same for every dataset
 *
 * **No credentials at all** — a fork, a pull request from a fork, a laptop,
 * `check-site.yml` — read the committed backup and print a notice. This is what
 * keeps `docs/current/data-ownership.md`'s "a fork can still build it" true where
 * it actually matters, and it is a supported way to build rather than a degraded
 * one.
 *
 * **Credentials present and the fetch fails** — fail the build. Never publish
 * stale data on the real deploy path. The asymmetry is the whole point: a build
 * that was *told* how to reach the source and could not is a different event from
 * one that was never told, and only the first is a fault.
 *
 * There is deliberately no third case where credentials are present, the fetch
 * fails, and the backup is used anyway. That is the behaviour everybody reaches
 * for and it is what silently publishes a week-old handicap on the day of a
 * Draft; the backup is behind git, which is where somebody can go and look.
 *
 * ## Why one module rather than one per dataset
 *
 * The rule above is the valuable part and it does not vary. Two datasets read
 * through here already — the observation log and the sweep log — and two more
 * scrapes are planned. A copy of these branches per dataset would be four places
 * to get the asymmetry subtly wrong, in a way that only shows up as a quietly
 * stale page.
 */

/**
 * A committed backup, read from disk.
 *
 * `readFileSync` against a path relative to the working directory, rather than a
 * bundler's `?raw` import. The first version of this used `?raw`, which inlines
 * the file at build time and reads beautifully — and broke the handicap scrape,
 * which then ran `astrosite/src/workflows/update-handicaps.ts` through `npx tsx`
 * with no bundler in sight. Node was handed a `.ndjson` and
 * answered `ERR_UNKNOWN_FILE_EXTENSION`; the scrape was dead for six hours before
 * anyone noticed, because the thing it broke was not the thing being changed.
 *
 * That scrape has since moved into the admin service, but three others still run
 * exactly this way and share `src/code/`, so the rule stands and
 * `test/unit/no-bundler-only-imports.test.ts` enforces it. No bundler-only syntax
 * in a module the workflows can reach. Relative to the
 * working directory rather than to `import.meta.url`, because the built site runs
 * this module from inside a bundled chunk where `import.meta.url` points at the
 * chunk. Every one of the three callers — `astro build`, `tsx`, and `vitest` —
 * runs from `astrosite/`, which is the assumption `data.ts` already makes with
 * its own `glob("src/data/...")`.
 *
 * Throws when the file is missing, which is the right direction: the backup is
 * the last resort, and a last resort that silently reads as empty is worse than
 * none at all.
 */
export function readBackup(pathFromRepoRoot: string): string {
    return readFileSync(join("..", pathFromRepoRoot), "utf-8");
}

/**
 * Every route the site build reads, named once.
 *
 * The readers below use these and `scripts/wait-for-admin.ts` waits for these, so
 * the two cannot drift: adding a dataset adds one entry and both sides follow. A
 * list repeated in a workflow file would be a list that is right until somebody
 * adds the third scrape and forgets the second copy — which is the shape of most
 * of the bugs this migration has produced.
 */
export const ROUTES = {
    history: "/api/handicaps/history",
    checks: "/api/handicaps/checks",
} as const;

/** The admin service's base URL and the ID token that gets past IAP. Both, or neither. */
export type Credentials = {
    baseUrl: string;
    token: string;
};

/**
 * The credentials in the environment, or nothing.
 *
 * A base URL rather than a URL per dataset, because the alternative is a pair of
 * variables per collection and a deploy workflow that grows a step every time the
 * admin learns to serve something. The path belongs to the caller, which knows
 * which log it wants.
 *
 * Both or neither, and a half-configured build is a failure rather than a quiet
 * fallback. Setting one of these is a statement of intent — somebody wired this
 * deploy to the API — and answering that with the committed backup would be the
 * silent stale publish this file exists to prevent, arrived at by a typo instead
 * of an outage.
 */
export function credentialsFrom(env: Record<string, string | undefined>): Credentials | undefined {
    const baseUrl = env.ADMIN_API_URL?.trim();
    const token = env.ADMIN_API_TOKEN?.trim();

    if (!baseUrl && !token) return undefined;
    if (!baseUrl || !token) {
        throw new Error(
            "ADMIN_API_URL and ADMIN_API_TOKEN have to be set together. " +
                `Got ${baseUrl ? "the URL" : "no URL"} and ${token ? "a token" : "no token"}. ` +
                "Unset both to build from the committed backups instead.",
        );
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export type LoadOptions<T> = {
    /** The path under the admin service, e.g. `/api/handicaps/history`. */
    path: string;
    /** The committed backup's contents, from `readBackup` above. */
    backup: string;
    /** NDJSON to rows, validating each one. */
    parse: (ndjson: string) => T[];
    /** What this is, for the messages. Lower case, e.g. "handicap history". */
    what: string;
    /** Where the backup lives, for the notice. */
    backupPath: string;
    env?: Record<string, string | undefined>;
    fetch?: typeof globalThis.fetch;
    notify?: (message: string) => void;
};

/**
 * One dataset, from wherever this build is entitled to read it.
 *
 * Throws rather than returning a failure: every caller is a page that cannot
 * render without it, so there is no branch worth writing at any call site, and an
 * exception out of a top-level await is exactly "fail the build".
 */
export async function loadFromAdmin<T>(options: LoadOptions<T>): Promise<T[]> {
    const env = options.env ?? process.env;
    const doFetch = options.fetch ?? globalThis.fetch;
    const notify = options.notify ?? ((message: string) => console.warn(message));

    const credentials = credentialsFrom(env);

    if (!credentials) {
        notify(
            `Building the ${options.what} from the committed backup, ${options.backupPath}, because ` +
                "this build has no credentials for the admin service. That is expected for a fork, a " +
                "pull request, a laptop and check-site.yml. The file is a backup: it is as current as " +
                "the last time a job committed it, which is not necessarily today.",
        );
        return options.parse(options.backup);
    }

    const url = `${credentials.baseUrl}${options.path}`;

    let response: Response;
    try {
        response = await doFetch(url, {
            headers: {
                // The way `.github/actions/request-deploy` gets in: Workload
                // Identity Federation, then an ID token for the IAP audience.
                authorization: `Bearer ${credentials.token}`,
                accept: "application/x-ndjson",
            },
        });
    } catch (error) {
        // A transport failure, never the service's answer. Fatal, because this
        // build was told how to reach the source.
        throw new Error(`Could not reach the ${options.what} at ${url}: ${String(error)}`);
    }

    if (!response.ok) {
        throw new Error(
            `The ${options.what} at ${url} answered ${response.status}. This build has credentials, so ` +
                "it fails rather than publishing the committed backup as though it were current.",
        );
    }

    const rows = options.parse(await response.text());

    /*
     * An empty answer is a failure here, where it is a success at the endpoint.
     *
     * The endpoint cannot tell an empty store from a store it has not filled yet,
     * so it answers 200 with no rows and is right to. A *build* can: this site has
     * had both of these logs for a year, and a deploy that renders every player
     * with no handicap and no sweep to date it by is the worst outcome available
     * to any of this — the one the plan's own post-mortem calls out, where
     * deleting the data directories produced 77 pages instead of 328 and nothing
     * objected.
     */
    if (rows.length === 0) {
        throw new Error(
            `The ${options.what} at ${url} is empty. Refusing to publish a site without it; if the ` +
                "store really is empty, build without credentials to use the backup.",
        );
    }

    return rows;
}
