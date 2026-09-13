import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `vi.mock` is hoisted above the imports, so the handler under test gets this stub
 * instead of the real `generatePlayerAvatar` — and, just as importantly, the
 * `@google/generative-ai` SDK is never loaded at all. Mocking at the boundary of our
 * own code rather than inside the SDK keeps these tests about the HTTP contract:
 * what a caller must send, and what they get back.
 */
const generatePlayerAvatar = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/prompts/avatar/genai", () => ({ generatePlayerAvatar }));

import { GeneratePlayerAvatar } from "../../src/functions/generate-player-avatar";
import { serveFunction, type ServedFunction } from "../support/http-function";

const API_KEY = "test-astrosite-api-key";

const authorized = { authorization: `Bearer ${API_KEY}` };

/** A minimal-but-valid pair of images, in the shape the README documents. */
const validBody = {
    photo: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    sample: { inlineData: { data: "iVBORw0KGgo=", mimeType: "image/png" } },
};

describe("GeneratePlayerAvatar", () => {
    let avatar: ServedFunction;

    beforeAll(async () => {
        avatar = await serveFunction("GeneratePlayerAvatar", GeneratePlayerAvatar);
    });

    afterAll(async () => {
        await avatar.stop();
    });

    beforeEach(() => {
        vi.stubEnv("GOOGLE_GEMINI_API_KEY", "test-gemini-api-key");
        vi.stubEnv("ASTROSITE_API_KEY", API_KEY);
        generatePlayerAvatar.mockResolvedValue(JSON.stringify({ avatar: "iVBORw0KGgo=", mimeType: "image/png" }));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
        vi.restoreAllMocks();
    });

    describe("authentication", () => {
        it("turns away a caller with no Authorization header", async () => {
            const response = await avatar.postJson("/", validBody);

            expect(response.status).toBe(401);
            expect(generatePlayerAvatar).not.toHaveBeenCalled();
        });

        it("turns away a caller with the wrong key", async () => {
            const response = await avatar.postJson("/", validBody, {
                headers: { authorization: "Bearer not-the-key" },
            });

            expect(response.status).toBe(401);
            expect(generatePlayerAvatar).not.toHaveBeenCalled();
        });

        it("accepts the key however the caller capitalises the scheme", async () => {
            const response = await avatar.postJson("/", validBody, {
                headers: { authorization: `bearer ${API_KEY}` },
            });

            expect(response.status).toBe(200);
        });
    });

    describe("configuration", () => {
        it.each([
            ["the Gemini key", "GOOGLE_GEMINI_API_KEY"],
            ["the site key", "ASTROSITE_API_KEY"],
        ])("refuses to run at all without %s", async (_description, variable) => {
            vi.stubEnv(variable, undefined);

            const response = await avatar.postJson("/", validBody, { headers: authorized });

            expect(response.status).toBe(500);
            expect(generatePlayerAvatar).not.toHaveBeenCalled();
        });
    });

    describe("on a good request", () => {
        it("hands the two images to the generator and returns what it produced", async () => {
            const response = await avatar.postJson("/", validBody, { headers: authorized });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ avatar: "iVBORw0KGgo=", mimeType: "image/png" });
            expect(generatePlayerAvatar).toHaveBeenCalledWith("test-gemini-api-key", validBody.photo, validBody.sample);
        });

        it("reads a body that arrived as text rather than parsed JSON", async () => {
            // Some callers (and some proxies) send JSON without a JSON content-type.
            const response = await avatar.fetch("/", {
                method: "POST",
                headers: { ...authorized, "content-type": "text/plain" },
                body: JSON.stringify(validBody),
            });

            expect(response.status).toBe(200);
        });

        it("lets a browser on any origin read the response", async () => {
            const response = await avatar.postJson("/", validBody, { headers: authorized });

            expect(response.headers.get("access-control-allow-origin")).toBe("*");
        });
    });

    describe("on a bad request", () => {
        it("explains what was wrong with the payload", async () => {
            const response = await avatar.postJson("/", { photo: "", sample: {} }, { headers: authorized });

            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({
                error: "Invalid payload",
                details: [
                    "photo must not be an empty string.",
                    "sample object must include one of: data, base64, or inlineData.",
                ],
            });
            expect(generatePlayerAvatar).not.toHaveBeenCalled();
        });

        it("does not reach for Gemini when an image is missing entirely", async () => {
            const response = await avatar.postJson("/", { photo: validBody.photo }, { headers: authorized });

            expect(response.status).toBe(400);
            expect(generatePlayerAvatar).not.toHaveBeenCalled();
        });
    });

    describe("when generation fails", () => {
        it("reports the failure without leaking a stack trace", async () => {
            generatePlayerAvatar.mockRejectedValue(new Error("Gemini response did not include a generated image."));

            const response = await avatar.postJson("/", validBody, { headers: authorized });

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                error: "Internal server error",
                message: "Gemini response did not include a generated image.",
            });
        });
    });
});
