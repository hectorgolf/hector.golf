import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const extractScorecardInformationBase64 = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/prompts/scorecard-detection/genai", () => ({ extractScorecardInformationBase64 }));

import { ExtractScorecardInformation } from "../../src/functions/scorecard-detection";
import { serveFunction, type ServedFunction } from "../support/http-function";

const API_KEY = "test-astrosite-api-key";

const authorized = { authorization: `Bearer ${API_KEY}` };

const scorecard = { image: "iVBORw0KGgo=", mime: "image/png" };

describe("ExtractScorecardInformation", () => {
    let scorecards: ServedFunction;

    beforeAll(async () => {
        scorecards = await serveFunction("ExtractScorecardInformation", ExtractScorecardInformation);
    });

    afterAll(async () => {
        await scorecards.stop();
    });

    beforeEach(() => {
        vi.stubEnv("GOOGLE_GEMINI_API_KEY", "test-gemini-api-key");
        vi.stubEnv("ASTROSITE_API_KEY", API_KEY);
        extractScorecardInformationBase64.mockResolvedValue({ players: [{ name: "Lasse", strokes: 82 }] });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
        vi.restoreAllMocks();
    });

    it("turns away an unauthenticated caller", async () => {
        const response = await scorecards.postJson("/", scorecard);

        expect(response.status).toBe(401);
        expect(extractScorecardInformationBase64).not.toHaveBeenCalled();
    });

    it("returns what the model read off the scorecard", async () => {
        const response = await scorecards.postJson("/", scorecard, { headers: authorized });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ players: [{ name: "Lasse", strokes: 82 }] });
    });

    it("defaults to prompt version 1 when the caller does not ask for one", async () => {
        await scorecards.postJson("/", scorecard, { headers: authorized });

        expect(extractScorecardInformationBase64).toHaveBeenCalledWith(
            "test-gemini-api-key",
            scorecard.image,
            scorecard.mime,
            1,
        );
    });

    it("passes on the prompt version the caller asked for, as a number", async () => {
        // The site sends this as a string; `parseInt` in the handler is the reason
        // this test exists, because the prompt is chosen with `===`.
        await scorecards.postJson("/", { ...scorecard, version: "3" }, { headers: authorized });

        expect(extractScorecardInformationBase64).toHaveBeenCalledWith(
            "test-gemini-api-key",
            scorecard.image,
            scorecard.mime,
            3,
        );
    });

    it.each([
        ["no mime type", { image: scorecard.image }],
        ["no image", { mime: scorecard.mime }],
    ])("rejects a request with %s", async (_description, body) => {
        const response = await scorecards.postJson("/", body, { headers: authorized });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "Invalid request" });
        expect(extractScorecardInformationBase64).not.toHaveBeenCalled();
    });

    it("does not echo the caller's credentials back in the error details", async () => {
        // The 400 response reports the request headers to help debugging, so this is
        // worth holding in place: the Authorization header is stripped out of them.
        const response = await scorecards.postJson("/", {}, { headers: authorized });

        expect(JSON.stringify(await response.json())).not.toContain(API_KEY);
    });
});
