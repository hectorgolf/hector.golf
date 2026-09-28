import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getGenerativeModel = vi.hoisted(() => vi.fn());
vi.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: class {
        getGenerativeModel = getGenerativeModel;
    },
}));

import { generatePlayerAvatar } from "../../src/lib/prompts/avatar/genai";

/**
 * That the avatar path goes through `withRetry` as well.
 *
 * Its sibling `biography-retries.test.ts` explains why this is worth its own
 * file: the helper failing is loud, and the wrapper going missing from a call
 * site is silent. An image model is the likelier of the two to be told it is in
 * demand, so the wrapper matters here at least as much.
 *
 * The SDK is mocked rather than the model passed in, because `generatePlayerAvatar`
 * builds its own model — unlike the biography prompt, which takes one.
 */

const PHOTO = "aGVsbG8=";
const SAMPLE = "d29ybGQ=";

const busy = () =>
    Object.assign(new Error("[503 Service Unavailable] This model is currently experiencing high demand"), {
        status: 503,
    });

const anImage = (data = "cG5n") => ({
    response: { candidates: [{ content: { parts: [{ inlineData: { data, mimeType: "image/png" } }] } }] },
});

const modelThat = (generateContent: ReturnType<typeof vi.fn>) => {
    getGenerativeModel.mockReturnValue({ generateContent });
    return generateContent;
};

describe("generating an avatar when the model is busy", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        getGenerativeModel.mockReset();
    });

    it("tries again after a 503 and returns the image the retry produced", async () => {
        const generateContent = modelThat(
            vi.fn().mockRejectedValueOnce(busy()).mockResolvedValueOnce(anImage("cmV0cmllZA==")),
        );

        const pending = generatePlayerAvatar("a-key", PHOTO, SAMPLE);
        await vi.runAllTimersAsync();

        expect(JSON.parse(await pending)).toMatchObject({ avatar: "cmV0cmllZA==", mimeType: "image/png" });
        expect(generateContent).toHaveBeenCalledTimes(2);
    });

    it("gives up with the status intact once the attempts are spent", async () => {
        const generateContent = modelThat(vi.fn().mockRejectedValue(busy()));

        const pending = generatePlayerAvatar("a-key", PHOTO, SAMPLE);
        const settled = expect(pending).rejects.toMatchObject({ status: 503 });
        await vi.runAllTimersAsync();
        await settled;

        expect(generateContent).toHaveBeenCalledTimes(4);
    });

    /**
     * A response with no image in it is not the API refusing to answer — it
     * answered, and we could not use what came back. Retrying it would spend
     * three more image generations on a prompt question, and the failure carries
     * no status precisely because the SDK never saw an error.
     */
    it("does not retry a response that came back without an image", async () => {
        const generateContent = modelThat(vi.fn().mockResolvedValue({ response: { candidates: [] } }));

        await expect(generatePlayerAvatar("a-key", PHOTO, SAMPLE)).rejects.toThrow(/did not include a generated image/);
        expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it("does not retry a request the next attempt would fail the same way", async () => {
        const generateContent = modelThat(
            vi.fn().mockRejectedValue(Object.assign(new Error("[400 Bad Request] malformed"), { status: 400 })),
        );

        const pending = generatePlayerAvatar("a-key", PHOTO, SAMPLE);
        const settled = expect(pending).rejects.toMatchObject({ status: 400 });
        await vi.runAllTimersAsync();
        await settled;

        expect(generateContent).toHaveBeenCalledTimes(1);
    });
});
