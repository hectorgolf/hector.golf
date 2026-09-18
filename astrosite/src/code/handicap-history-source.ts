import { type HandicapHistoryEntry, schema as HandicapHistoryEntrySchema } from "@hector/schemas/src/handicaps.ts";

// The committed backup, inlined by the bundler at build time.
//
// `?raw` rather than `node:fs` so that this module stays isomorphic. The site is
// a static build today with nothing hydrated, so a `node:fs` read would work —
// right up until the first component carries a `client:` directive, at which
// point it breaks the client bundle instead of this file. A bundler-resolved
// import cannot develop that problem.
//
// It also means a missing backup is a build error rather than an empty history,
// which is the right direction to fail in: the file is the last resort, and a
// last resort that silently evaluates to nothing is worse than none at all.
import committedBackup from "../../../data/handicaps/observations.ndjson?raw";

/**
 * Where the handicap history comes from, and the rule for choosing.
 *
 * Step 3 of `docs/plans/handicaps-to-firestore.md`. Firestore is the system of
 * record; `data/handicaps/observations.ndjson` is a backup that a build without
 * credentials can still read. The plan is emphatic that those are different
 * things — "a backup that is also the build input is not a backup; it is the
 * production path under a misleading name" — so this asks the API when it can
 * and says loudly when it cannot.
 *
 * ## The rule
 *
 * **No credentials at all** — a fork, a pull request from a fork, a laptop,
 * `check-site.yml` — read the committed backup and print a notice. This is what
 * keeps `docs/current/data-ownership.md`'s "a fork can still build it" true
 * where it actually matters, and it is a supported way to build rather than a
 * degraded one.
 *
 * **Credentials present and the fetch fails** — fail the build. Never publish
 * stale data on the real deploy path. The asymmetry is the whole point: a build
 * that was *told* how to reach the source and could not is a different event
 * from one that was never told, and only the first is a fault.
 *
 * There is deliberately no third case where credentials are present, the fetch
 * fails, and the backup is used anyway. That is the behaviour everybody reaches
 * for and it is what silently publishes a week-old handicap on the day of a
 * Draft; the backup is behind git, which is where somebody can go and look.
 */

/** The endpoint, and the ID token that gets past IAP. Both, or neither. */
export type Credentials = {
    url: string;
    token: string;
};

/**
 * The credentials in the environment, or nothing.
 *
 * Both or neither, and a half-configured build is a failure rather than a quiet
 * fallback. Setting one of these is a statement of intent — somebody wired this
 * deploy to the API — and answering that with the committed backup would be the
 * silent-stale-publish this file exists to prevent, arrived at by a typo instead
 * of an outage.
 */
export function credentialsFrom(env: Record<string, string | undefined>): Credentials | undefined {
    const url = env.HANDICAP_HISTORY_URL?.trim();
    const token = env.HANDICAP_HISTORY_TOKEN?.trim();

    if (!url && !token) return undefined;
    if (!url || !token) {
        throw new Error(
            "HANDICAP_HISTORY_URL and HANDICAP_HISTORY_TOKEN have to be set together. " +
                `Got ${url ? "the URL" : "no URL"} and ${token ? "a token" : "no token"}. ` +
                "Unset both to build from the committed backup instead.",
        );
    }
    return { url, token };
}

/** What the NDJSON body parses to, with every row validated. */
export function parseHistory(ndjson: string): HandicapHistoryEntry[] {
    return ndjson
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => HandicapHistoryEntrySchema.parse(JSON.parse(line)));
}

export type LoadOptions = {
    env?: Record<string, string | undefined>;
    fetch?: typeof globalThis.fetch;
    /** The committed file, injectable so a test does not need one on disk. */
    backup?: string;
    notify?: (message: string) => void;
};

/**
 * The history this build should use.
 *
 * Throws rather than returning a failure: every caller is a page that cannot
 * render without it, so there is no branch worth writing at any call site, and
 * an exception out of a top-level await is exactly "fail the build".
 */
export async function loadHandicapHistory(options: LoadOptions = {}): Promise<HandicapHistoryEntry[]> {
    const env = options.env ?? process.env;
    const doFetch = options.fetch ?? globalThis.fetch;
    const backup = options.backup ?? committedBackup;
    const notify = options.notify ?? ((message: string) => console.warn(message));

    const credentials = credentialsFrom(env);

    if (!credentials) {
        notify(
            "Building the handicap history from the committed backup, " +
                "data/handicaps/observations.ndjson, because this build has no credentials for the " +
                "admin service. That is expected for a fork, a pull request, a laptop and " +
                "check-site.yml. The file is a backup: it is as current as the last time a job " +
                "committed it, which is not necessarily today.",
        );
        return parseHistory(backup);
    }

    let response: Response;
    try {
        response = await doFetch(credentials.url, {
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
        throw new Error(`Could not reach the handicap history at ${credentials.url}: ${String(error)}`);
    }

    if (!response.ok) {
        throw new Error(
            `The handicap history at ${credentials.url} answered ${response.status}. ` +
                "This build has credentials, so it fails rather than publishing the committed backup " +
                "as though it were current.",
        );
    }

    const entries = parseHistory(await response.text());

    /*
     * An empty answer is a failure here, where it is a success at the endpoint.
     *
     * The endpoint cannot tell an empty store from a store it has not filled
     * yet, so it answers 200 with no rows and is right to. A *build* can: this
     * site has had a handicap history for years, and a deploy that renders every
     * player with no handicaps at all is the worst outcome available to any of
     * this — the one the plan's own post-mortem calls out, where deleting the
     * data directories produced 77 pages instead of 328 and nothing objected.
     */
    if (entries.length === 0) {
        throw new Error(
            `The handicap history at ${credentials.url} is empty. Refusing to publish a site with no ` +
                "handicaps; if the store really is empty, build without credentials to use the backup.",
        );
    }

    return entries;
}
