import { HttpFunction, Request, Response } from "@google-cloud/functions-framework";

/**
 * Public, cacheable read of an app.hector.golf tournament payload.
 *
 * This exists for one reason: app.hector.golf requires `x-api-key`, and the website
 * is a static site on GitHub Pages. Polling the upstream from the browser would mean
 * shipping HECTOR_APP_API_KEY in page source, so the key stays here and the browser
 * talks to this instead. The response body is the upstream payload verbatim — all
 * the reading and normalising happens in the site's own code, which is where the
 * tests for it live.
 *
 * It is not an open proxy: the upstream URL is a fixed template and the only thing a
 * caller controls is an event id constrained to the pattern below. The site keeps the
 * same pattern in `src/code/leaderboards/sources.ts`; keep the two in step.
 */
const UPSTREAM = "https://app.hector.golf/api/tournament";
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Browsers allowed to read the response.
 *
 * The data is published on the public website anyway, so this is about keeping the
 * proxy from quietly becoming someone else's free API rather than about secrecy.
 */
const ALLOWED_ORIGINS = [
    "https://www.hector.golf",
    "https://hector.golf",
    "http://localhost:4321",
    "http://localhost:4322",
];

const resolveOrigin = (request: Request): string | undefined => {
    const origin = request.header("origin");
    if (!origin) return undefined;
    return ALLOWED_ORIGINS.includes(origin) ? origin : undefined;
};

export const TournamentLeaderboard: HttpFunction = async (request: Request, response: Response) => {
    const origin = resolveOrigin(request);
    if (origin) {
        response.set("Access-Control-Allow-Origin", origin);
    }
    // The allowed origin is chosen per request, so shared caches must key on it.
    response.set("Vary", "Origin");

    if (request.method === "OPTIONS") {
        response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.set("Access-Control-Max-Age", "3600");
        response.status(204).send("");
        return;
    }

    response.set("content-type", "application/json; charset=utf-8");

    if (request.method !== "GET") {
        response.set("Cache-Control", "no-store");
        response.status(405).json({ error: "method_not_allowed" });
        return;
    }

    if (typeof process.env.HECTOR_APP_API_KEY === "undefined") {
        console.error("HECTOR_APP_API_KEY is not set - cannot reach app.hector.golf");
        response.set("Cache-Control", "no-store");
        response.status(500).json({ error: "server_misconfigured" });
        return;
    }

    const requestedEvent = request.query.event;
    const eventId = typeof requestedEvent === "string" ? requestedEvent.trim() : "";
    if (!EVENT_ID_PATTERN.test(eventId)) {
        response.set("Cache-Control", "no-store");
        response.status(400).json({ error: "invalid_event", message: "Expected an ?event= identifier." });
        return;
    }

    try {
        const upstream = await fetch(`${UPSTREAM}?event=${encodeURIComponent(eventId)}`, {
            method: "GET",
            headers: {
                "x-api-key": process.env.HECTOR_APP_API_KEY,
                accept: "application/json",
            },
            signal: AbortSignal.timeout(10_000),
        });

        if (!upstream.ok) {
            console.error(`app.hector.golf returned ${upstream.status} ${upstream.statusText} for ${eventId}`);
            // Never cache a failure: the next poll, thirty seconds later, should retry.
            response.set("Cache-Control", "no-store");
            response.status(502).json({ error: "upstream_unavailable", status: upstream.status });
            return;
        }

        const payload = await upstream.json();

        // Short max-age because the browser polls on a similar cadence; the longer
        // s-maxage lets a shared cache absorb a whole clubhouse refreshing at once.
        response.set("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
        response.status(200).json(payload);
    } catch (error) {
        console.error(`Failed to read app.hector.golf for ${eventId}`, error);
        response.set("Cache-Control", "no-store");
        response.status(502).json({ error: "upstream_unreachable" });
    }
};

export default TournamentLeaderboard;
