import { describe, expect, it, vi } from "vitest";

import {
    DEFAULT_RETRY_POLICY,
    backoffMs,
    isTransient,
    statusOf,
    withRetry,
    type RetryPolicy,
} from "../../src/lib/retry";

/**
 * Trying a model call again when the model said "not now".
 *
 * A sweep of 45 biographies stopped at its fourth player on 2026-09-28 with
 * `[503] This model is currently experiencing high demand ... Please try again
 * later`, and the interesting part of that sentence is the last four words: the
 * API is telling us the remedy and the code was throwing it away.
 *
 * What is worth pinning is the *classification*, because getting it wrong is
 * silent in both directions — retrying a 400 delays a real error by three calls
 * and four identical log lines, and not retrying a 503 costs a run of 45.
 */

/** An SDK error as `@google/generative-ai` throws it: a message and a status. */
const apiError = (status: number, message = `[${status}] upstream said so`) =>
    Object.assign(new Error(message), { status });

/** No waiting, and a fixed draw so a jittered delay is still an assertion. */
const hooks = (random = () => 1) => ({
    // Typed with its argument so the waits themselves can be asserted.
    sleep: vi.fn(async (_ms: number) => {}),
    random,
    onRetry: vi.fn(),
});

describe("which failures are worth trying again", () => {
    it("retries the statuses whose documented remedy is to try again", () => {
        for (const status of [429, 500, 502, 503, 504]) {
            expect(isTransient(apiError(status))).toBe(true);
        }
    });

    /**
     * A 400 is a prompt this code built wrongly and a 401 is the key — neither
     * improves on the third attempt, and retrying them delays the error
     * somebody has to read behind three waits.
     */
    it("does not retry a request that will fail the same way again", () => {
        for (const status of [400, 401, 403, 404, 422]) {
            expect(isTransient(apiError(status))).toBe(false);
        }
    });

    /**
     * A throw with no status is a network fault or a bug on this side, and this
     * cannot tell them apart. The conservative reading is the one that does not
     * turn a programming error into four of them.
     */
    it("does not retry a failure that carries no status at all", () => {
        expect(isTransient(new Error("fetch failed"))).toBe(false);
        expect(statusOf(new Error("fetch failed"))).toBeUndefined();
    });

    /**
     * Duck-typed rather than `instanceof`: the error is built inside the bundled
     * SDK, and a second copy of that module would make a constructor check
     * quietly false — turning every retryable failure back into a fatal one.
     */
    it("reads the status off anything shaped like an SDK error", () => {
        expect(statusOf({ status: 503 })).toBe(503);
        expect(statusOf({ status: "503" })).toBeUndefined();
        expect(statusOf(undefined)).toBeUndefined();
    });
});

describe("the waits", () => {
    const policy: RetryPolicy = { attempts: 4, baseDelayMs: 1000, maxDelayMs: 8000 };

    it("doubles, and stops doubling at the ceiling", () => {
        const undiluted = () => 1
        expect(backoffMs(2, policy, undiluted)).toBe(1000);
        expect(backoffMs(3, policy, undiluted)).toBe(2000);
        expect(backoffMs(4, policy, undiluted)).toBe(4000);
        expect(backoffMs(5, policy, undiluted)).toBe(8000);
        expect(backoffMs(6, policy, undiluted)).toBe(8000);
    });

    /**
     * Full jitter, because a demand spike is exactly when every client is
     * retrying on the same schedule. Waiting less than planned is never worse
     * here, so the draw spans the whole interval rather than half of it.
     */
    it("draws the actual wait from zero up to the planned one", () => {
        expect(backoffMs(3, policy, () => 0)).toBe(0);
        expect(backoffMs(3, policy, () => 0.5)).toBe(1000);
        expect(backoffMs(3, policy, () => 1)).toBe(2000);
    });
});

describe("withRetry", () => {
    it("returns the first answer without waiting when there is nothing wrong", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi.fn(async () => "a biography");

        await expect(withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry })).resolves.toBe(
            "a biography",
        );
        expect(operation).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    /** The case this exists for: the fourth player of a 45-player sweep. */
    it("tries again after a 503 and returns what the retry produced", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(apiError(503, "This model is currently experiencing high demand"))
            .mockResolvedValueOnce("a biography");

        await expect(withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry })).resolves.toBe(
            "a biography",
        );
        expect(operation).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(1000);
    });

    it("waits longer each time, up to the whole budget", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi.fn(async () => {
            throw apiError(503);
        });

        await expect(withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry })).rejects.toThrow(
            /upstream said so/,
        );
        expect(operation).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.attempts);
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    });

    /**
     * Rethrown as it arrived rather than wrapped. The admin quotes the status
     * and the message into its run log, and a wrapper would replace the one
     * sentence that says which of the two kinds of failure this was.
     */
    it("rethrows the last failure untouched once the attempts are spent", async () => {
        const { sleep, random, onRetry } = hooks();
        const last = apiError(503, "still busy");
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(apiError(503, "busy"))
            .mockRejectedValue(last);

        await expect(withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry })).rejects.toBe(last);
    });

    it("gives up immediately on a failure that will not improve", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi.fn(async () => {
            throw apiError(400, "your prompt is malformed");
        });

        await expect(withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry })).rejects.toThrow(
            /malformed/,
        );
        expect(operation).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("can be told not to retry at all", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi.fn(async () => {
            throw apiError(503);
        });

        await expect(
            withRetry(operation, { attempts: 1, baseDelayMs: 1000, maxDelayMs: 8000 }, { sleep, random, onRetry }),
        ).rejects.toThrow();
        expect(operation).toHaveBeenCalledTimes(1);
    });

    /**
     * The retry is reported, because a run that took nine seconds longer than
     * usual and then worked is the only visible trace of a demand spike — and
     * at `warn`, since nothing is broken.
     */
    it("says that it is retrying, and what it is retrying against", async () => {
        const { sleep, random, onRetry } = hooks();
        const operation = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(apiError(503, "high demand"))
            .mockResolvedValueOnce("a biography");

        await withRetry(operation, DEFAULT_RETRY_POLICY, { sleep, random, onRetry });

        expect(onRetry).toHaveBeenCalledWith(
            expect.objectContaining({ attempt: 1, of: 4, status: 503, waitMs: 1000, message: "high demand" }),
        );
    });

    /**
     * Three retries at 1s, 2s and 4s is about seven seconds added to one
     * player. `GeneratePlayerBiography` is deployed with `--timeout=540s` and
     * the admin holds a 600s request open for the whole sweep, so the budget is
     * the reason this is small rather than patient.
     */
    it("keeps the worst case inside the caller's request budget", () => {
        const undiluted = () => 1
        const waits = [2, 3, 4].map((attempt) => backoffMs(attempt, DEFAULT_RETRY_POLICY, undiluted));
        expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000);
    });
});
