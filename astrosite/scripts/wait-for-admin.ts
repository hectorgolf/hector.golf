import { ROUTES, credentialsFrom } from "../src/code/admin-api";

/**
 * Wait for the admin service to be serving the routes this build reads.
 *
 * ## The race this exists for
 *
 * A merge that both adds an endpoint to the admin and teaches the site to read it
 * starts `deploy-admin` and `deploy-site` at the same moment. They are separate
 * workflows with separate durations and neither waits for the other, so the site
 * build can reach an admin still serving the previous image and ask for a route
 * it does not have. That happened on 2026-09-18: the build asked for
 * `/api/handicaps/checks`, got a 404, and failed — correctly, because a build
 * with credentials that cannot reach the API must not publish the backup as
 * though it were current. The site then stayed seven hours stale.
 *
 * `deploy-admin` takes about a minute, so waiting turns that failure into a
 * delay. See *Decisions* in `docs/plans/handicaps-to-firestore.md` for the three
 * alternatives and why this is the only one that does.
 *
 * It does not replace the rule. Shipping the endpoint and the reader in separate
 * merges is still the right way round, and costs nothing; this is what stops the
 * other way round being an outage.
 *
 * ## What it waits for, and what it refuses to wait for
 *
 * Not every failure is worth waiting on, and treating them alike is how a
 * readiness check becomes a way to spend three minutes discovering a typo.
 *
 * - **404** is the race itself: the image is old and the route is not there yet.
 *   Wait.
 * - **5xx, or no answer at all** is a service starting, restarting, or briefly
 *   unreachable. Wait.
 * - **401 or 403** is IAP refusing the token. No amount of waiting fixes a wrong
 *   audience or a missing grant, and the build is going to fail either way — so
 *   fail now and say which route and which status, rather than in three minutes.
 * - **200** is ready.
 *
 * ## Why it is a script and not a `curl` loop in the workflow
 *
 * Because of `ROUTES`. The routes live beside the readers that use them, so
 * adding a dataset adds one entry and both the build and this check follow. A
 * list written out in YAML is a list that is correct until the third scrape lands
 * and somebody updates one copy.
 */

/** How long to wait in total, and how often to ask. */
const TIMEOUT_MS = 3 * 60 * 1000;
const INTERVAL_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Attempt = { ready: boolean; fatal?: string; saw: string };

/**
 * What a status means for waiting, separated from the asking.
 *
 * Pure, and exported, because this is the part with the judgement in it: which
 * failures are a deploy in flight and which are a build that is going to fail
 * whatever happens. Driving it through `fetch` to test it would be testing
 * `fetch`.
 */
export function verdictOf(status: number): Attempt {
    if (status >= 200 && status < 300) return { ready: true, saw: `${status}` };

    if (status === 401 || status === 403) {
        return {
            ready: false,
            saw: `${status}`,
            fatal:
                `IAP refused this build's token with ${status}. That is a credential problem rather ` +
                "than a deploy still in flight, and waiting will not fix it — check the WIF provider, " +
                "the service account and TF_IAP_OAUTH_CLIENT_ID.",
        };
    }

    return { ready: false, saw: `${status}` };
}

export async function ask(url: string, token: string, doFetch = globalThis.fetch): Promise<Attempt> {
    try {
        const response = await doFetch(url, {
            headers: { authorization: `Bearer ${token}`, accept: "application/x-ndjson" },
        });

        // Only the status matters here, and a body nobody reads is a body the
        // connection stays open for. The history endpoint answers about 80KB;
        // leaving it unread holds the socket, and a held socket holds Node's
        // event loop. Cancelling says "I am done with this" at the one moment
        // that is true.
        await response.body?.cancel();

        return verdictOf(response.status);
    } catch (error) {
        // No answer at all: DNS, TLS, a cold start. Worth waiting through.
        return { ready: false, saw: `no answer (${String(error)})` };
    }
}

export async function main(): Promise<void> {
    const credentials = credentialsFrom(process.env);

    if (!credentials) {
        // The same "no credentials is a supported way to build" rule the readers
        // follow. Nothing to wait for; the build will read the committed backups.
        console.log("No admin credentials, so nothing to wait for: this build reads the committed backups.");
        return;
    }

    const urls = Object.values(ROUTES).map((path) => `${credentials.baseUrl}${path}`);
    const deadline = Date.now() + TIMEOUT_MS;

    for (const url of urls) {
        for (;;) {
            const attempt = await ask(url, credentials.token);

            if (attempt.ready) {
                console.log(`${url} is ready (${attempt.saw}).`);
                break;
            }
            if (attempt.fatal) {
                console.error(`${url}: ${attempt.fatal}`);
                process.exit(1);
            }
            if (Date.now() >= deadline) {
                console.error(
                    `${url} was still answering ${attempt.saw} after ${TIMEOUT_MS / 1000}s. ` +
                        "If this is a 404, deploy-admin is probably still running or failed — check it, " +
                        "then re-run this deploy. Building now would publish the committed backup as " +
                        "though it were current, which this refuses to do.",
                );
                process.exit(1);
            }
            console.log(`${url} answered ${attempt.saw}; waiting…`);
            await sleep(INTERVAL_MS);
        }
    }
}

// Only when run directly, so importing this for a test starts no waiting.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    await main();

    /*
     * Exit rather than return, and this line is worth four minutes of every
     * deploy.
     *
     * The first production run did its work in seven seconds and then sat there
     * until 19:02:11 — exactly 240 seconds after its last request. That is Google
     * Front End's idle keep-alive: the connection to `admin.hector.golf` stayed
     * open, a live socket keeps Node's event loop alive, and the process had
     * nothing left to do but wait to be hung up on. A readiness check that costs
     * four minutes is worse than the race it absorbs.
     *
     * Cancelling the response bodies above removes the reason the socket is held,
     * but that depends on how the far end behaves and this does not. The failure
     * paths already exit explicitly; this is the success path doing the same.
     */
    process.exit(0);
}
