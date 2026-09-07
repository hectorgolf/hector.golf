import { MScorecardAuthError, MScorecardHttpError } from "./errors.ts";
import type { MScorecardSession } from "./types.ts";

export const DEFAULT_API_BASE_URL = "https://www.mscorecard.com/api/v2.3";
export const DEFAULT_LEGACY_BASE_URL = "https://www.mscorecard.com/mscorecardx/m";
export const DEFAULT_APP_VERSION = "9110";

/** Node's global `fetch`, or a stand-in for it in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TransportOptions = {
    /** Defaults to Node's global `fetch`. */
    fetch?: FetchLike;
    apiBaseUrl?: string;
    legacyBaseUrl?: string;
    /** Sent as `versionNumber` to the legacy endpoints. */
    appVersion?: string;
    /** Called whenever the server hands back a new access token. */
    onTokenRotated?: (accessToken: string) => void;
};

type JsonObject = Record<string, unknown>;

/**
 * The HTTP layer for both mScorecard backends.
 *
 * The one thing worth knowing: **the access token rotates**. Any `/api/v2.3`
 * response may carry a fresh `accessToken`, and when it does the previous one
 * stops working. Rotation is silent, so this class writes the new token back after
 * every request; a client that forgets sees an unexplained 401 partway through a
 * round.
 */
export class MScorecardTransport {
    private readonly fetchImpl: FetchLike;
    private readonly apiBaseUrl: string;
    private readonly legacyBaseUrl: string;
    private readonly appVersion: string;
    private readonly onTokenRotated?: (accessToken: string) => void;

    email = "";
    accessToken = "";
    legacyToken = "";
    userID = "";

    constructor(options: TransportOptions = {}) {
        const globalFetch = globalThis.fetch as FetchLike | undefined;
        const fetchImpl = options.fetch ?? globalFetch;
        if (!fetchImpl) {
            throw new Error("No fetch() available. Use Node 18+ or pass a fetch implementation.");
        }
        this.fetchImpl = fetchImpl;
        this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
        this.legacyBaseUrl = trimTrailingSlash(options.legacyBaseUrl ?? DEFAULT_LEGACY_BASE_URL);
        this.appVersion = options.appVersion ?? DEFAULT_APP_VERSION;
        this.onTokenRotated = options.onTokenRotated;
    }

    get session(): MScorecardSession {
        return {
            email: this.email,
            accessToken: this.accessToken,
            legacyToken: this.legacyToken,
            userID: this.userID,
        };
    }

    adopt(session: MScorecardSession): void {
        this.email = session.email;
        this.accessToken = session.accessToken;
        this.legacyToken = session.legacyToken;
        this.userID = session.userID;
    }

    /** An unauthenticated JSON call. Only login needs this. */
    async postJsonAnonymous(path: string, payload: unknown): Promise<JsonObject> {
        return this.json("POST", this.url(this.apiBaseUrl, path), payload, false);
    }

    async get(path: string, query: Record<string, string> = {}): Promise<JsonObject> {
        const search = new URLSearchParams({ app: "1", ...query });
        return this.json("GET", `${this.url(this.apiBaseUrl, path)}?${search}`, undefined, true);
    }

    async put(path: string, payload: unknown): Promise<JsonObject> {
        return this.json("PUT", this.url(this.apiBaseUrl, path), payload, true);
    }

    async patch(path: string, payload: unknown): Promise<JsonObject> {
        return this.json("PATCH", this.url(this.apiBaseUrl, path), payload, true);
    }

    /**
     * A DELETE with no request body.
     *
     * This is the odd one out among the v2.3 writes: it carries no `ts` version
     * token, sends nothing at all, and answers with a bare `[]` rather than an
     * object — so there is no chain to advance and normally no token to rotate.
     */
    async delete(path: string): Promise<unknown> {
        const url = this.url(this.apiBaseUrl, path);
        if (!this.accessToken) {
            throw new MScorecardAuthError(`Not authenticated: call login() or resume() before DELETE ${url}.`);
        }
        const response = await this.fetchImpl(url, {
            method: "DELETE",
            headers: {
                Accept: "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.accessToken}`,
            },
        });
        const parsed = await this.parse(response, "DELETE", url);
        // The observed response is an array, but honour a token if one ever appears.
        if (isJsonObject(parsed)) this.rotateToken(parsed);
        return parsed;
    }

    /**
     * A call to one of the legacy PHP endpoints.
     *
     * These are form-encoded, and the `password` field takes the hashed token from
     * the login response rather than the plaintext password. They return bare JSON
     * arrays and never rotate anything.
     */
    async legacyPost<T>(path: string, fields: Record<string, string>): Promise<T> {
        if (!this.legacyToken) {
            throw new MScorecardAuthError(`Not authenticated: call login() or resume() before ${path}.`);
        }
        const url = this.url(this.legacyBaseUrl, path);
        const body = new URLSearchParams({
            email: this.email,
            password: this.legacyToken,
            versionNumber: this.appVersion,
            timestamp: `${Date.now()}`,
            ...fields,
        });
        const response = await this.fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body.toString(),
        });
        return (await this.parse(response, "POST", url)) as T;
    }

    private async json(method: string, url: string, payload: unknown, authenticated: boolean): Promise<JsonObject> {
        const headers: Record<string, string> = {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/json",
        };
        if (authenticated) {
            if (!this.accessToken) {
                throw new MScorecardAuthError(`Not authenticated: call login() or resume() before ${method} ${url}.`);
            }
            headers.Authorization = `Bearer ${this.accessToken}`;
        }
        const response = await this.fetchImpl(url, {
            method,
            headers,
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        const parsed = await this.parse(response, method, url);
        if (!isJsonObject(parsed)) {
            throw new MScorecardHttpError("Expected a JSON object", response.status, method, url, JSON.stringify(parsed));
        }
        // Login also returns an accessToken, but that is the session starting rather
        // than an existing token being replaced, so it is not a rotation.
        if (authenticated) this.rotateToken(parsed);
        return parsed;
    }

    /** Picks up a rotated access token if the response carried one. */
    private rotateToken(body: JsonObject): void {
        const rotated = body.accessToken;
        if (typeof rotated === "string" && rotated.length > 0 && rotated !== this.accessToken) {
            this.accessToken = rotated;
            this.onTokenRotated?.(rotated);
        }
    }

    private async parse(response: Response, method: string, url: string): Promise<unknown> {
        const text = await response.text();
        if (response.status === 401 || response.status === 403) {
            throw new MScorecardAuthError(
                `mScorecard rejected our credentials (${method} ${url} -> HTTP ${response.status}). ` +
                    `The access token may have rotated: every response that carries one invalidates the previous.`,
            );
        }
        if (!response.ok) {
            throw new MScorecardHttpError("Request failed", response.status, method, url, text);
        }
        if (text.trim() === "") return {};
        try {
            return JSON.parse(text) as unknown;
        } catch {
            throw new MScorecardHttpError("Response was not JSON", response.status, method, url, text);
        }
    }

    private url(base: string, path: string): string {
        return `${base}/${path.replace(/^\//, "")}`;
    }
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
}
