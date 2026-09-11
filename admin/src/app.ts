import { Hono } from "hono";

import { projectId, revision } from "./config.ts";
import { checkFirestore } from "./firestore.ts";
import { viewerFromHeaders } from "./identity.ts";
import { renderStatusPage } from "./page.ts";

/**
 * The routes, as a value rather than a running server, so tests can call
 * `app.request(...)` without binding a port. `src/index.ts` is what listens.
 */
export const app = new Hono();

/**
 * Liveness. Deliberately touches nothing: a probe that depends on Firestore
 * turns a database blip into a restart loop, which is strictly worse than a
 * running service reporting that its database is unreachable.
 */
app.get("/healthz", (c) => c.text("ok\n"));

/** Readiness, which does depend on Firestore, and says so honestly in its status. */
app.get("/readyz", async (c) => {
    const status = await checkFirestore();
    return c.json(status, status.reachable ? 200 : 503);
});

app.get("/", async (c) => {
    const [viewer, firestore] = [viewerFromHeaders(c.req.raw.headers), await checkFirestore()];
    return c.html(renderStatusPage({ viewer, firestore, revision, projectId }));
});

app.notFound((c) => c.text("Not found\n", 404));

app.onError((error, c) => {
    // Cloud Run collects stderr into Cloud Logging, so this is the log.
    console.error("Unhandled error", error);
    return c.text("Internal error\n", 500);
});
