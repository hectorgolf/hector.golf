import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerBiographyInput } from "../../src/lib/prompts/biography/common";

const generatePlayerBiography = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/prompts/biography/genai", () => ({ generatePlayerBiography }));

import { GeneratePlayerBiography } from "../../src/functions/generate-player-biography";
import { serveFunction, type ServedFunction } from "../support/http-function";

const API_KEY = "test-astrosite-api-key";

const authorized = { authorization: `Bearer ${API_KEY}` };

const player: PlayerBiographyInput = {
    name: "Lasse",
    gender: "male",
    homeClub: "Hector Golf Club",
    miscellaneousDetails: [],
    previousAppearances: [{ name: "Hector Open", year: 2022 }],
    hectorWins: [],
    victorWins: [],
    allPastEvents: [{ name: "Hector Open", year: 2022 }],
    nextEvent: { name: "Hector Trophée", year: 2026, participates: true },
    retired: false,
    otherGeneratedBiographies: [],
};

describe("GeneratePlayerBiography", () => {
    let biography: ServedFunction;

    beforeAll(async () => {
        biography = await serveFunction("GeneratePlayerBiography", GeneratePlayerBiography);
    });

    afterAll(async () => {
        await biography.stop();
    });

    beforeEach(() => {
        vi.stubEnv("GOOGLE_GEMINI_API_KEY", "test-gemini-api-key");
        vi.stubEnv("ASTROSITE_API_KEY", API_KEY);
        generatePlayerBiography.mockResolvedValue(JSON.stringify({ biography: ["Lasse plays golf."] }));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
        vi.restoreAllMocks();
    });

    it("turns away an unauthenticated caller", async () => {
        const response = await biography.postJson("/", player);

        expect(response.status).toBe(401);
        expect(generatePlayerBiography).not.toHaveBeenCalled();
    });

    it("passes the player straight through to the generator", async () => {
        const response = await biography.postJson("/", player, { headers: authorized });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ biography: ["Lasse plays golf."] });
        expect(generatePlayerBiography).toHaveBeenCalledWith("test-gemini-api-key", player);
    });

    it("rejects a payload with no player name, and shows what one looks like", async () => {
        const response = await biography.postJson("/", { gender: "male" }, { headers: authorized });

        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string; message: string };
        expect(body.error).toBe("Invalid payload");
        // The message embeds a worked example; a caller should be able to copy it.
        expect(body.message).toContain('"name":"John"');
        expect(generatePlayerBiography).not.toHaveBeenCalled();
    });

    it("turns a generator failure into a 500 rather than a hung request", async () => {
        generatePlayerBiography.mockRejectedValue(new Error("Gemini is having a day"));

        const response = await biography.postJson("/", player, { headers: authorized });

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ message: "Gemini is having a day" });
    });

    /**
     * A busy model is not this function being broken, and the difference is
     * what the caller needs.
     *
     * `withRetry` has already tried and given up by the time the handler sees
     * this, so the honest answer is "come back later". It matters because the
     * admin's sweep quotes the status straight into its run log: on 2026-09-28
     * that read "the biography function answered 500 Internal Server Error" and
     * sent somebody to Cloud Logging to find the `[503] high demand` underneath.
     */
    it("reports a model that is busy as a 503, with the upstream status", async () => {
        generatePlayerBiography.mockRejectedValue(
            Object.assign(new Error("[503 Service Unavailable] This model is currently experiencing high demand"), {
                status: 503,
            }),
        );

        const response = await biography.postJson("/", player, { headers: authorized });

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            error: "The model is unavailable",
            upstreamStatus: 503,
        });
    });

    it("keeps reporting a failure of our own making as a 500", async () => {
        generatePlayerBiography.mockRejectedValue(
            Object.assign(new Error("[400 Bad Request] the prompt is malformed"), { status: 400 }),
        );

        const response = await biography.postJson("/", player, { headers: authorized });

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: "Internal server error", upstreamStatus: 400 });
    });
});
