import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TournamentLeaderboard } from "../../src/functions/tournament-leaderboard";
import { serveFunction, type ServedFunction } from "../support/http-function";

/**
 * The leaderboard proxy is the one function with no GenAI in it, so it is the one
 * whose whole contract — CORS, method handling, the event id pattern, what is and is
 * not cached — can be pinned down over real HTTP. Everything upstream of it is a
 * single `fetch`, which the tests replace.
 */
const UPSTREAM_PREFIX = "https://app.hector.golf/api/tournament";

/** The payload this function is supposed to hand back untouched. */
const upstreamPayload = { name: "Hector 2026", standings: [{ player: "Lasse", toPar: -3 }] };

/** Stands in for app.hector.golf and records what it was asked for. */
const upstreamReturns = (response: Response) => {
    const stub = vi.fn(async () => response);
    vi.stubGlobal("fetch", stub);
    return stub;
};

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("TournamentLeaderboard", () => {
    let leaderboard: ServedFunction;

    beforeAll(async () => {
        leaderboard = await serveFunction("TournamentLeaderboard", TournamentLeaderboard);
    });

    afterAll(async () => {
        await leaderboard.stop();
    });

    beforeEach(() => {
        vi.stubEnv("HECTOR_APP_API_KEY", "test-app-api-key");
        // The function logs upstream failures, which is right in production and noise here.
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("on a good request", () => {
        it("returns the upstream payload verbatim", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(upstreamPayload);
        });

        it("asks app.hector.golf for that event, with the key the browser never sees", async () => {
            const upstream = upstreamReturns(jsonResponse(upstreamPayload));

            await leaderboard.get("/?event=HECTOR2026");

            expect(upstream).toHaveBeenCalledOnce();
            const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
            expect(url).toBe(`${UPSTREAM_PREFIX}?event=HECTOR2026`);
            expect(new Headers(init.headers).get("x-api-key")).toBe("test-app-api-key");
        });

        it("lets caches hold on to it briefly, because the browser polls", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.headers.get("cache-control")).toBe(
                "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
            );
        });
    });

    describe("CORS", () => {
        it("lets the website read the response", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026", {
                headers: { origin: "https://www.hector.golf" },
            });

            expect(response.headers.get("access-control-allow-origin")).toBe("https://www.hector.golf");
        });

        it("lets a local dev server read it too", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026", {
                headers: { origin: "http://localhost:4321" },
            });

            expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:4321");
        });

        it("does not hand anyone else a permission to read it", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026", {
                headers: { origin: "https://not-hector.example.com" },
            });

            expect(response.headers.get("access-control-allow-origin")).toBeNull();
        });

        it("tells shared caches that the answer depends on the origin", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.headers.get("vary")).toBe("Origin");
        });

        it("answers a preflight without going upstream", async () => {
            const upstream = upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.fetch("/?event=HECTOR2026", {
                method: "OPTIONS",
                headers: { origin: "https://hector.golf" },
            });

            expect(response.status).toBe(204);
            expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
            expect(upstream).not.toHaveBeenCalled();
        });
    });

    describe("refuses to be an open proxy", () => {
        it.each([
            ["nothing at all", "/"],
            ["an empty event", "/?event="],
            ["a path traversal", "/?event=../../secrets"],
            ["a whole URL", "/?event=https://example.com/"],
            ["something absurdly long", `/?event=${"A".repeat(65)}`],
        ])("rejects %s", async (_description, path) => {
            const upstream = upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get(path);

            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ error: "invalid_event" });
            expect(upstream).not.toHaveBeenCalled();
        });

        it("accepts the event ids app.hector.golf actually uses", async () => {
            upstreamReturns(jsonResponse(upstreamPayload));

            const response = await leaderboard.get("/?event=HECTORMATCHPLAY2024");

            expect(response.status).toBe(200);
        });

        it("rejects anything that is not a GET", async () => {
            const response = await leaderboard.postJson("/?event=HECTOR2026", {});

            expect(response.status).toBe(405);
            expect(await response.json()).toMatchObject({ error: "method_not_allowed" });
        });
    });

    describe("when something is wrong", () => {
        it("says so, rather than 200, when the key is missing", async () => {
            vi.stubEnv("HECTOR_APP_API_KEY", undefined);

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.status).toBe(500);
            expect(await response.json()).toMatchObject({ error: "server_misconfigured" });
        });

        it("reports an upstream refusal as a bad gateway", async () => {
            upstreamReturns(new Response("nope", { status: 403 }));

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: "upstream_unavailable", status: 403 });
        });

        it("survives the upstream being unreachable", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => {
                    throw new Error("getaddrinfo ENOTFOUND app.hector.golf");
                }),
            );

            const response = await leaderboard.get("/?event=HECTOR2026");

            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ error: "upstream_unreachable" });
        });

        it.each([
            ["a missing key", "/?event=HECTOR2026", () => vi.stubEnv("HECTOR_APP_API_KEY", undefined)],
            ["an invalid event", "/?event=nope!", () => {}],
        ])("never lets a cache keep %s", async (_description, path, arrange) => {
            upstreamReturns(jsonResponse(upstreamPayload));
            arrange();

            const response = await leaderboard.get(path);

            expect(response.headers.get("cache-control")).toBe("no-store");
        });
    });
});
