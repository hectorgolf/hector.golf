import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerativeModel } from "@google/generative-ai";

import { GeneratePlayerBiographyPromptV1 } from "../../src/lib/prompts/biography/biography-v1";
import type { PlayerBiographyInput } from "../../src/lib/prompts/biography/common";

/**
 * That the biography path actually goes through `withRetry`.
 *
 * `retry.test.ts` proves the helper retries; this proves the one call that
 * needed it is wrapped. Separate because the failure modes are different and
 * only one of them is silent: a helper that stops retrying fails its own tests
 * loudly, whereas deleting the wrapper here leaves every other test green and
 * costs a run of 45 the next time Gemini has a busy afternoon.
 *
 * Fake timers rather than an injected clock, so the call site keeps the plain
 * `withRetry(...)` signature it reads best with. Nothing here waits a real
 * second.
 */

const player: PlayerBiographyInput = {
    name: "Eero",
    gender: "male",
    homeClub: "Hector Golf Club",
    miscellaneousDetails: [],
    previousAppearances: [{ name: "Hector Trophée", year: 2026 }],
    hectorWins: [],
    victorWins: [],
    allPastEvents: [{ name: "Hector Trophée", year: 2026 }],
    nextEvent: undefined,
    retired: false,
    otherGeneratedBiographies: [],
};

const busy = (message = "This model is currently experiencing high demand") =>
    Object.assign(new Error(`[503 Service Unavailable] ${message}`), { status: 503 });

const answered = (biography: string[]) => ({
    response: { text: () => JSON.stringify({ biography }) },
});

/** Only the one method the prompt uses; the rest of a `GenerativeModel` is not involved. */
const modelOf = (generateContent: ReturnType<typeof vi.fn>) =>
    ({ generateContent }) as unknown as GenerativeModel;

describe("generating a biography when the model is busy", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** The 2026-09-28 failure, and what should have happened instead. */
    it("tries again after a 503 and returns the biography the retry produced", async () => {
        const generateContent = vi
            .fn()
            .mockRejectedValueOnce(busy())
            .mockResolvedValueOnce(answered(["Eero played once.", "He has not been back."]));

        const pending = GeneratePlayerBiographyPromptV1(modelOf(generateContent), player);
        await vi.runAllTimersAsync();

        expect(JSON.parse(await pending).biography).toEqual(["Eero played once.", "He has not been back."]);
        expect(generateContent).toHaveBeenCalledTimes(2);
    });

    it("survives a spike that lasts more than one retry", async () => {
        const generateContent = vi
            .fn()
            .mockRejectedValueOnce(busy())
            .mockRejectedValueOnce(busy())
            .mockResolvedValueOnce(answered(["Written on the third try."]));

        const pending = GeneratePlayerBiographyPromptV1(modelOf(generateContent), player);
        await vi.runAllTimersAsync();

        expect(JSON.parse(await pending).biography).toEqual(["Written on the third try."]);
        expect(generateContent).toHaveBeenCalledTimes(3);
    });

    /**
     * A spike that outlasts the budget still fails, and fails with the upstream
     * status intact — `generate-player-biography` reads it to answer 503 rather
     * than 500, which is what puts "the model is busy" in the admin's run log
     * instead of sending somebody to Cloud Logging.
     */
    it("gives up with the status intact once the attempts are spent", async () => {
        const generateContent = vi.fn().mockRejectedValue(busy("still busy"));

        const pending = GeneratePlayerBiographyPromptV1(modelOf(generateContent), player);
        const settled = expect(pending).rejects.toMatchObject({ status: 503 });
        await vi.runAllTimersAsync();
        await settled;

        expect(generateContent).toHaveBeenCalledTimes(4);
    });

    /**
     * The prompt is built once and reused across the retries. Rebuilding it per
     * attempt would be harmless today and is not what the code does; asserting
     * the call is identical keeps a future "just rebuild it in the loop" from
     * quietly sending the model a different question on the second try.
     */
    it("asks the same question each time", async () => {
        const generateContent = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValueOnce(answered(["Text."]));

        const pending = GeneratePlayerBiographyPromptV1(modelOf(generateContent), player);
        await vi.runAllTimersAsync();
        await pending;

        expect(generateContent.mock.calls[0]).toEqual(generateContent.mock.calls[1]);
    });

    it("does not retry a failure the next attempt would repeat", async () => {
        const generateContent = vi
            .fn()
            .mockRejectedValue(Object.assign(new Error("[400 Bad Request] malformed"), { status: 400 }));

        const pending = GeneratePlayerBiographyPromptV1(modelOf(generateContent), player);
        const settled = expect(pending).rejects.toMatchObject({ status: 400 });
        await vi.runAllTimersAsync();
        await settled;

        expect(generateContent).toHaveBeenCalledTimes(1);
    });
});
