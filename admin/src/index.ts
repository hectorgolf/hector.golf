import { serve } from "@hono/node-server";

import { app } from "./app.ts";
import { firestoreDatabaseId, port, revision } from "./config.ts";

/**
 * Bind 0.0.0.0, not localhost: Cloud Run routes to the container's external
 * interface, and a server listening only on the loopback address is invisible to
 * it — which presents as a startup probe that never passes.
 */
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(
        `hector-admin listening on ${info.address}:${info.port} ` +
            `(revision ${revision}, firestore ${firestoreDatabaseId})`
    );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
        console.log(`${signal} received, shutting down`);
        process.exit(0);
    });
}
