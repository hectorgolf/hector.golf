import { readFileSync } from "fs";
import { join } from "path";

/**
 * Where the site's data comes from, now that it does not come from the
 * repository.
 *
 * Everything under `src/data/` moved into Firestore — see
 * `docs/plans/everything-to-firestore.md`. The admin service serves it at
 * `/api/data/snapshot`, and this module is the one place that knows how to ask.
 *
 * ## The rule, which is the whole design
 *
 * **Credentials present and the fetch fails → fail the build.**
 * **No credentials at all → fall back to the committed snapshot, and say so.**
 *
 * Not "fall back when the fetch fails". That version is the one that publishes
 * last week's handicaps for a week because nobody noticed the service was down,
 * and it is the reason this is spelled out here rather than left to a `try`.
 *
 * Having no credentials is not a degraded deploy. It is a pull request from a
 * fork, `check-site.yml` proving the site compiles, or somebody building on a
 * laptop — none of which publish anything, and all of which must keep working.
 * A deploy always has credentials, so a deploy always uses the live data or
 * fails loudly.
 *
 * ## The committed snapshot
 *
 * `src/data/snapshot.json` is generated, not authored. The admin rewrites it
 * when the data changes, and it is the only data file left in the repository. It
 * is also the only copy of the data outside Firestore, which is the second
 * reason it exists: a system of record with no second copy has no undo.
 */

/**
 * The admin service's origin, e.g. `https://admin.hector.golf`.
 *
 * Set by the deploy workflow from `vars.TF_ADMIN_DOMAIN`. Unset everywhere else,
 * which is exactly what "no credentials" means in practice.
 */
const ADMIN_ORIGIN = process.env.HECTOR_ADMIN_ORIGIN;

/**
 * An ID token carrying the IAP audience, minted by `google-github-actions/auth`.
 *
 * The same mechanism `.github/actions/request-deploy` uses. It is a token rather
 * than a key because IAP authenticates the caller from it, and the audience has
 * to be the OAuth client in front of the service or it is rejected.
 */
const ID_TOKEN = process.env.HECTOR_ADMIN_ID_TOKEN;

export type Snapshot = {
    generatedAt: string;
    players: unknown[];
    events: unknown[];
    courses: unknown[];
    leaderboards: unknown[];
    clubs: unknown[];
    handicapObservations: unknown[];
    handicapChecks: unknown[];
};

const REQUIRED_KEYS: Array<keyof Snapshot> = [
    "players",
    "events",
    "courses",
    "leaderboards",
    "clubs",
    "handicapObservations",
    "handicapChecks",
];

/**
 * Fetched once per build and reused.
 *
 * Module scope rather than a cache with a lifetime, because a build *is* the
 * lifetime: the process starts, renders 328 pages and exits. Every loader in
 * `data.ts` awaits this, so the memoisation is what stops one build making seven
 * identical requests.
 */
let pending: Promise<Snapshot> | undefined;

export function snapshot(): Promise<Snapshot> {
    pending ??= load();
    return pending;
}

async function load(): Promise<Snapshot> {
    if (!ADMIN_ORIGIN || !ID_TOKEN) {
        const reason = !ADMIN_ORIGIN ? "HECTOR_ADMIN_ORIGIN is unset" : "HECTOR_ADMIN_ID_TOKEN is unset";
        // Deliberately loud. A build reading the fallback is a normal thing for a
        // pull request and an alarming thing for a deploy, and the only way to
        // tell those apart from a log is for this line to be hard to miss.
        console.warn(
            `\n  ****  Building from the committed snapshot, not from live data  ****\n` +
                `  ${reason}, so this build cannot reach the admin service.\n` +
                `  This is expected on a fork, a pull request or a laptop. It is NOT expected on a deploy.\n`,
        );
        return fromDisk();
    }

    const url = `${ADMIN_ORIGIN.replace(/\/$/, "")}/api/data/snapshot`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { authorization: `Bearer ${ID_TOKEN}`, accept: "application/json" },
        });
    } catch (error) {
        // A transport failure with credentials in hand. Fatal, per the rule.
        throw new Error(`Could not reach the admin service at ${url}: ${error}`);
    }

    if (!response.ok) {
        throw new Error(
            `The admin service answered ${response.status} for the data snapshot. ` +
                `Refusing to build from the committed fallback, because this build has credentials and ` +
                `a deploy that silently publishes stale data is worse than one that fails.`,
        );
    }

    const payload = validate(await response.json(), url);
    console.log(`Built from live data, generated at ${payload.generatedAt}`);
    return payload;
}

/**
 * Read the fallback off disk, relative to the working directory.
 *
 * Not relative to `import.meta.url`, which is the obvious way and the wrong one:
 * Astro bundles this module into `dist/.prerender/chunks/`, so at build time
 * `import.meta.url` points into the bundle and the path resolves to a file that
 * was never there. The glob this replaced — `glob("src/data/**")` in `data.ts` —
 * was working-directory-relative for the same reason, and the build has always
 * run from `astrosite/`.
 */
function fromDisk(): Snapshot {
    const path = join(process.cwd(), "src/data/snapshot.json");
    return validate(JSON.parse(readFileSync(path, "utf-8")), path);
}

/**
 * Check the payload has every collection in it, before anything reads one.
 *
 * A missing collection would otherwise surface as an empty array — no players,
 * no events — and an empty array renders as a page with nothing on it rather
 * than as an error. That is the failure this migration most needs to not have:
 * a successful deploy of an empty site.
 */
function validate(payload: unknown, from: string): Snapshot {
    if (!payload || typeof payload !== "object") {
        throw new Error(`The data snapshot from ${from} is not an object`);
    }
    const missing = REQUIRED_KEYS.filter((key) => !Array.isArray((payload as Record<string, unknown>)[key]));
    if (missing.length > 0) {
        throw new Error(`The data snapshot from ${from} is missing: ${missing.join(", ")}`);
    }
    return payload as Snapshot;
}
