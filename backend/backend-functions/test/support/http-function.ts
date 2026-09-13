import { http, type HttpFunction } from "@google-cloud/functions-framework";
import { getTestServer } from "@google-cloud/functions-framework/testing";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Serves a Cloud Function the way the Functions Framework serves it, on a throwaway
 * port, and hands back a `fetch` bound to it.
 *
 * The point of going through `getTestServer` rather than calling the handler with a
 * hand-rolled fake request is that the handler's `request` and `response` are then
 * the real Express objects the framework builds: the same body parsers (so a JSON
 * body arrives as an object and a text body as a string), the same `request.header()`
 * and `request.query` and `request.headersDistinct`, the same header casing, the same
 * behaviour when a handler rejects. A fake that only implements the three methods a
 * handler happens to call today will keep passing after someone reaches for a fourth.
 *
 * The handler is registered under its deployed name with `functions.http()`, which is
 * also how the framework's loader would find it, so a test reads the way a deploy does.
 */
/**
 * The client's own `fetch`, captured before any test gets a chance to stub the global
 * one. A function that calls an upstream service is usually tested by replacing
 * `globalThis.fetch`; if the test client used the stub too, the call to the function
 * under test would be answered by the very thing the test is trying to mock out.
 */
const clientFetch = globalThis.fetch.bind(globalThis);

export type ServedFunction = {
    /** Absolute base URL of the running server, e.g. `http://127.0.0.1:51234`. */
    readonly url: string;
    /** `fetch`, but relative paths are resolved against this function's server. */
    fetch(path: string, init?: RequestInit): Promise<Response>;
    /** GET, for the common case. */
    get(path: string, init?: RequestInit): Promise<Response>;
    /** POST with a JSON body and `content-type: application/json`. */
    postJson(path: string, body: unknown, init?: RequestInit): Promise<Response>;
    /** Shuts the server down. Call it from `afterAll`. */
    stop(): Promise<void>;
};

export const serveFunction = async (name: string, handler: HttpFunction): Promise<ServedFunction> => {
    http(name, handler);
    const server: Server = getTestServer(name);

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;

    const call = (path: string, init?: RequestInit) => clientFetch(new URL(path, url), init);

    return {
        url,
        fetch: call,
        get: (path, init) => call(path, { ...init, method: "GET" }),
        postJson: (path, body, init) =>
            call(path, {
                ...init,
                method: "POST",
                headers: { "content-type": "application/json", ...init?.headers },
                body: JSON.stringify(body),
            }),
        stop: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
};
