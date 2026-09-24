import { timingSafeEqual } from "node:crypto";

import { HttpFunction, Request, Response } from "@google-cloud/functions-framework";

/**
 * The door app.hector.golf knocks on when a score changes.
 *
 * It presents an API key and this asks the admin service to republish that
 * tournament's standings — `POST /api/jobs/leaderboards/run`, which does the work
 * in the request. Without it the board on hector.golf moves at the Cloud
 * Scheduler tick, four times a day, which is not a live leaderboard.
 *
 * ## Why a relay rather than a direct call
 *
 * The admin is behind IAP, and IAP admits Google principals holding
 * `roles/iap.httpsResourceAccessor` — a caller has to present an ID token Google
 * signed, for the audience of the OAuth client in front of the service.
 * app.hector.golf is somebody else's system and holds no Google credential.
 *
 * The two ways to close that gap are a Google service account key on their side,
 * or a shim on ours that speaks both. This is the shim: an API key in — which is
 * the only thing the two systems already know how to exchange, and the same shape
 * app.hector.golf uses for its own endpoints — and a Google-signed token out.
 *
 * What it deliberately is *not* is a way past IAP. It gets in the same front door
 * as Cloud Scheduler and the humans, as its own service account, and the endpoint
 * still reads the caller from IAP's header. There is no second ingress, no
 * `run.invoker` binding that skips the proxy, and nothing here can reach the
 * admin that the admin would not have admitted anyway.
 *
 * ## Why it has a service account of its own
 *
 * `hector-leaderboard-trigger`, rather than the `hector-functions` identity the
 * other four run as. That identity is shared by three public endpoints, and IAP
 * access is the one grant in this project that reaches the service holding
 * everything. A separate account keeps "may get into the admin" attached to the
 * one function whose whole purpose it is.
 */

/** Where the work happens. The job's own endpoint, not a bespoke one. */
const JOB_PATH = "/api/jobs/leaderboards/run";

/**
 * How long to wait for the admin.
 *
 * The job reads app.hector.golf and makes a GitHub round trip inside the request
 * — seconds, not milliseconds — and the caller is waiting on this. Shorter than
 * the function's own timeout so that a slow admin produces a 504 from here with a
 * log line, rather than the platform cutting the request with nothing attached.
 */
const ADMIN_TIMEOUT_MS = 60_000;

/**
 * An ID token for this function's own service account, with `audience` in it.
 *
 * The metadata server rather than `google-auth-library`, which would be a
 * dependency for one HTTP call that is documented and stable. The audience is the
 * IAP OAuth client id and *not* the URL being called — that is what it would be
 * for a Cloud Run service with no IAP in front. Getting it wrong produces a 401
 * and no other symptom, which is why `terraform/scheduler.tf` says the same thing
 * beside the same value.
 */
const METADATA_IDENTITY =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

async function identityToken(audience: string): Promise<string | undefined> {
    try {
        const response = await fetch(`${METADATA_IDENTITY}?audience=${encodeURIComponent(audience)}`, {
            headers: { "Metadata-Flavor": "Google" },
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
            console.error(`The metadata server would not mint an ID token: ${response.status}`);
            return undefined;
        }
        const token = (await response.text()).trim();
        return token.length > 0 ? token : undefined;
    } catch (error) {
        console.error("Could not reach the metadata server for an ID token", error);
        return undefined;
    }
}

/**
 * Whether the presented key is the configured one, in constant time.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — which leaks the length of the key and nothing else. A plain `!==` would
 * leak rather more than that to somebody willing to make a few thousand requests
 * against an endpoint that is, by design, open to the internet.
 */
function keyMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export const RequestLeaderboardUpdate: HttpFunction = async (request: Request, response: Response) => {
    response.set("content-type", "application/json; charset=utf-8");
    // Nothing here is ever worth caching: it is a request to do something.
    response.set("Cache-Control", "no-store");

    if (request.method !== "POST") {
        // POST because it has an effect. A GET that publishes a leaderboard is one
        // link preview away from publishing a leaderboard.
        response.set("Allow", "POST");
        response.status(405).json({ error: "method_not_allowed" });
        return;
    }

    /*
     * The key is checked before anything else is looked at, and the order is the
     * point rather than the sequence it was written in.
     *
     * This endpoint is open to the internet, so every branch above the key check
     * is a fact a stranger can read off it. Checking the admin's address and the
     * IAP audience first would answer an unauthenticated caller with
     * `server_misconfigured` — telling them this deployment is half-built, which
     * is exactly when it is most worth probing. Below the check, the same answer
     * goes to a caller who has already proved they are app.hector.golf, and is
     * something they need: their push is being dropped and it is not their fault.
     *
     * A missing key is the one thing that cannot wait, because without it nobody
     * can be authenticated at all.
     */
    const expectedKey = process.env.LEADERBOARD_TRIGGER_KEY;
    if (!expectedKey) {
        console.error("RequestLeaderboardUpdate has no LEADERBOARD_TRIGGER_KEY, so it can admit nobody");
        response.status(500).json({ error: "server_misconfigured" });
        return;
    }

    const presented = request.header("x-api-key");
    if (!presented || !keyMatches(presented, expectedKey)) {
        // No detail, and no distinction between absent and wrong. This endpoint is
        // public and the only useful thing to tell an unauthenticated caller is
        // that it is not for them.
        console.warn("Refused a leaderboard update request presenting no valid key");
        response.status(401).json({ error: "unauthorized" });
        return;
    }

    const adminDomain = process.env.ADMIN_DOMAIN;
    const iapClientId = process.env.IAP_CLIENT_ID;
    if (!adminDomain || !iapClientId) {
        console.error("RequestLeaderboardUpdate does not know where to send this", {
            hasAdminDomain: Boolean(adminDomain),
            hasIapClientId: Boolean(iapClientId),
        });
        response.status(500).json({ error: "server_misconfigured" });
        return;
    }

    const token = await identityToken(iapClientId);
    if (!token) {
        response.status(500).json({ error: "no_identity_token" });
        return;
    }

    try {
        const admin = await fetch(`https://${adminDomain}${JOB_PATH}`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                // Both of these matter and neither is decoration. Astro's origin
                // check rejects a cross-site POST that arrives with *no* content
                // type at all, not only one carrying a form content type — so the
                // empty body is sent as JSON. And without `accept: application/json`
                // the endpoint answers a 303 to the Operations page, which is the
                // right answer for a browser and no answer at all for this.
                "content-type": "application/json",
                accept: "application/json",
            },
            body: "{}",
            signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
        });

        const body = await admin.text();
        // Passed through rather than translated: the admin already distinguishes
        // "ran and changed nothing" from "another run holds the lease" (409) from
        // "no key configured" (503) from "the job failed" (502), and app.hector.golf
        // deciding whether to retry wants that distinction rather than this
        // function's opinion of it.
        console.log(`The admin answered ${admin.status} to a leaderboard update request`);
        response.status(admin.status).send(body);
    } catch (error) {
        console.error("Could not reach the admin service", error);
        response.status(504).json({ error: "admin_unreachable" });
    }
};

export default RequestLeaderboardUpdate;
