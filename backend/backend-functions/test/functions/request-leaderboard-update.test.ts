import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestLeaderboardUpdate } from "../../src/functions/request-leaderboard-update";
import { serveFunction, type ServedFunction } from "../support/http-function";

/**
 * The relay is the only public endpoint here that can cause a commit, so what is
 * worth pinning is mostly what it refuses: a wrong key, a missing key, a GET.
 *
 * Both of the things it talks to are `fetch` — the metadata server for an ID
 * token, and the admin service for the work — so one stub stands in for both,
 * dispatching on the URL. That is also the assertion that matters most about the
 * outbound request: which audience the token was minted for, and that the token
 * reached the admin as a bearer credential.
 */

const METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const ADMIN = "https://admin.hector.golf/api/jobs/leaderboards/run";

const KEY = "the-configured-key";

type Stubbed = { calls: Array<[string, RequestInit]> };

/**
 * A metadata server that mints `test-id-token`, and an admin that answers `admin`.
 *
 * Anything else is a test that asked for a URL nobody expected, which fails loudly
 * rather than returning a plausible empty response.
 */
function upstreams(admin: Response, options: { metadata?: Response } = {}): Stubbed {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit = {}) => {
            calls.push([url, init]);
            if (url.startsWith(METADATA)) return options.metadata ?? new Response("test-id-token", { status: 200 });
            if (url === ADMIN) return admin;
            throw new Error(`Unexpected request to ${url}`);
        }),
    );
    return { calls };
}

const call = (fn: ServedFunction, headers: Record<string, string> = { "x-api-key": KEY }) =>
    fn.fetch("/", { method: "POST", body: "{}", headers: { "content-type": "application/json", ...headers } });

const ranOk = () =>
    new Response(JSON.stringify({ ran: "leaderboards", outcome: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });

describe("RequestLeaderboardUpdate", () => {
    let relay: ServedFunction;

    beforeAll(async () => {
        relay = await serveFunction("RequestLeaderboardUpdate", RequestLeaderboardUpdate);
    });

    afterAll(async () => {
        await relay.stop();
    });

    beforeEach(() => {
        vi.stubEnv("LEADERBOARD_TRIGGER_KEY", KEY);
        vi.stubEnv("ADMIN_DOMAIN", "admin.hector.golf");
        vi.stubEnv("IAP_CLIENT_ID", "1234.apps.googleusercontent.com");
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("who it turns away", () => {
        it("refuses a request presenting no key", async () => {
            upstreams(ranOk());

            const response = await relay.fetch("/", { method: "POST", body: "{}" });

            expect(response.status).toBe(401);
        });

        it("refuses a request presenting the wrong key", async () => {
            const { calls } = upstreams(ranOk());

            const response = await relay.fetch("/", { method: "POST", body: "{}", headers: { "x-api-key": "nope" } });

            expect(response.status).toBe(401);
            // Nothing was asked of anybody. A refused caller must not be able to
            // make this service mint a token or wake the admin up.
            expect(calls).toEqual([]);
        });

        it("says the same thing about a wrong key as about no key", async () => {
            upstreams(ranOk());

            const absent = await relay.fetch("/", { method: "POST", body: "{}" });
            const wrong = await relay.fetch("/", { method: "POST", body: "{}", headers: { "x-api-key": "nope" } });

            expect(await absent.json()).toEqual(await wrong.json());
        });

        it("refuses a GET even with the right key", async () => {
            // A GET that publishes a leaderboard is one link preview away from
            // publishing a leaderboard.
            upstreams(ranOk());

            const response = await relay.fetch("/", { headers: { "x-api-key": KEY } });

            expect(response.status).toBe(405);
        });

        it("does not admit anybody when it has no key of its own", async () => {
            vi.stubEnv("LEADERBOARD_TRIGGER_KEY", "");
            upstreams(ranOk());

            const response = await call(relay);

            expect(response.status).toBe(500);
        });

        it("tells an authenticated caller when it does not know where to send this", async () => {
            // Below the key check on purpose: a stranger gets 401, and only
            // app.hector.golf learns that its pushes are being dropped.
            vi.stubEnv("ADMIN_DOMAIN", "");
            upstreams(ranOk());

            const response = await call(relay);

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({ error: "server_misconfigured" });
        });
    });

    describe("what it asks the admin", () => {
        it("mints an ID token for the IAP client, not for the admin's URL", async () => {
            // The mistake that produces a 401 and no other symptom.
            const { calls } = upstreams(ranOk());

            await call(relay);

            const [url] = calls.find(([url]) => url.startsWith(METADATA))!;
            expect(url).toBe(`${METADATA}?audience=1234.apps.googleusercontent.com`);
        });

        it("posts to the job endpoint with the token, a JSON body and a JSON Accept", async () => {
            // Content type and Accept are both load-bearing: Astro's origin check
            // rejects a cross-site POST carrying no content type at all, and
            // without the Accept the endpoint answers a 303 to an HTML page.
            const { calls } = upstreams(ranOk());

            await call(relay);

            const [url, init] = calls.find(([url]) => url === ADMIN)!;
            expect(url).toBe(ADMIN);
            expect(init.method).toBe("POST");
            expect(init.body).toBe("{}");
            const headers = new Headers(init.headers);
            expect(headers.get("authorization")).toBe("Bearer test-id-token");
            expect(headers.get("content-type")).toBe("application/json");
            expect(headers.get("accept")).toBe("application/json");
        });

        it("does not call the admin at all when no token can be minted", async () => {
            const { calls } = upstreams(ranOk(), { metadata: new Response("", { status: 500 }) });

            const response = await call(relay);

            expect(response.status).toBe(500);
            expect(calls.some(([url]) => url === ADMIN)).toBe(false);
        });
    });

    describe("what it answers", () => {
        it("passes the admin's success back", async () => {
            upstreams(ranOk());

            const response = await call(relay);

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ran: "leaderboards", outcome: "ok" });
        });

        it("passes a lease collision back as a 409, so the caller can decide not to retry", async () => {
            // The admin already tells apart "another run is going" (409) from "no
            // key" (503) from "the job failed" (502). Translating those here would
            // throw away the only thing the caller can act on.
            upstreams(new Response(JSON.stringify({ skipped: "leaderboards" }), { status: 409 }));

            const response = await call(relay);

            expect(response.status).toBe(409);
        });

        it("passes a 503 back rather than calling it a success", async () => {
            upstreams(new Response(JSON.stringify({ because: "not-configured" }), { status: 503 }));

            expect((await call(relay)).status).toBe(503);
        });

        it("answers 504 when the admin cannot be reached", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async (url: string) => {
                    if (url.startsWith(METADATA)) return new Response("test-id-token", { status: 200 });
                    throw new Error("connection refused");
                }),
            );

            expect((await call(relay)).status).toBe(504);
        });

        it("never lets a response be cached", async () => {
            upstreams(ranOk());

            expect((await call(relay)).headers.get("cache-control")).toBe("no-store");
        });
    });
});
