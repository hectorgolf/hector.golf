/**
 * Trying a model call again when the answer was "not now".
 *
 * ## What this is for
 *
 * On 2026-09-28 a sweep of 45 biographies stopped at the fourth player:
 *
 *     [503 Service Unavailable] This model is currently experiencing high
 *     demand. Spikes in demand are usually temporary. Please try again later.
 *
 * That is not an error about the request. The prompt was fine, the key was
 * fine, and the same call a few seconds later would have worked — the API says
 * so itself, in the message. Treating it as fatal threw away the 41 players
 * behind it and the three biographies already drafted had to be drafted again.
 *
 * ## Which failures come back here, and which do not
 *
 * Only the statuses where "try again" is the documented remedy: 429 when we are
 * being rate limited, and 500/502/503/504 when the far end is unwell. A 400 is
 * a prompt this code built wrongly, a 401 or 403 is the key, and a 404 is a
 * model name that does not exist — retrying any of those spends three more
 * calls to be told the same thing, and delays the error that somebody has to
 * read.
 *
 * A failure carrying *no* status is not retried either. `@google/generative-ai`
 * throws `GoogleGenerativeAIFetchError` with a status for anything the API
 * answered, so a status-less throw is either a network fault or a bug on this
 * side, and this cannot tell those apart. The conservative reading is the one
 * that does not turn a programming error into four of them.
 *
 * ## Why the waits are small, and jittered
 *
 * Small because the caller is a person watching a button, or the admin holding
 * a Cloud Run request open for a 45-player sweep: `GeneratePlayerBiography` is
 * deployed with `--timeout=540s` and the admin's own request budget is 600s.
 * Three retries at 1s, 2s and 4s adds at most about seven seconds to one
 * player, which is worth it against losing the run. Thirty seconds of patient
 * backoff would not be.
 *
 * Jittered because a demand spike is exactly when every client is retrying on
 * the same schedule. Full jitter — a wait drawn uniformly from `[0, delay]` —
 * is the usual answer, and it costs nothing here: there is no case where
 * waiting *less* than planned is worse.
 *
 * `Retry-After` is not honoured, because the SDK does not expose it. Its error
 * carries `status`, `statusText` and `errorDetails`, and drops the headers, so
 * there is nothing to read. If that changes, a header-derived wait should win
 * over the schedule below.
 */

/** The statuses where trying again is the remedy rather than wishful thinking. */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export type RetryPolicy = {
    /** Total tries, including the first. 1 disables retrying. */
    attempts: number;
    /** The first wait; each subsequent one doubles before jitter. */
    baseDelayMs: number;
    /** The ceiling a doubled wait is clamped to. */
    maxDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    attempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
};

/** Injectable so the tests do not wait, and do not flake on a random draw. */
export type RetryHooks = {
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    onRetry: (detail: { attempt: number; of: number; status: number; waitMs: number; message: string }) => void;
};

const defaultHooks: RetryHooks = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    // Warn rather than error: nothing is broken yet, and a retry that then
    // succeeds is a thing worth seeing in the logs without it looking like an
    // incident. The one that finally throws is logged by the caller.
    onRetry: ({ attempt, of, status, waitMs, message }) =>
        console.warn(
            `Gemini answered ${status} on attempt ${attempt} of ${of}; retrying in ${waitMs}ms. ${message}`,
        ),
};

/**
 * The status an SDK error is reporting, when it is reporting one.
 *
 * Duck-typed rather than `instanceof GoogleGenerativeAIFetchError`, which
 * compares constructors: the error is built inside the bundled SDK, and a
 * second copy of that module — a hoisted duplicate, a test double — would make
 * the check quietly false and turn every retryable failure back into a fatal
 * one. The shape is what matters, and the shape is a number.
 */
export function statusOf(error: unknown): number | undefined {
    const status = (error as { status?: unknown } | undefined)?.status;
    return typeof status === "number" ? status : undefined;
}

export function isTransient(error: unknown): boolean {
    const status = statusOf(error);
    return status !== undefined && TRANSIENT_STATUSES.has(status);
}

/**
 * The wait before try number `attempt` (2 for the first retry), with full jitter.
 *
 * Exported for the tests, which is also how "1s, 2s, 4s, capped at 8s" stays
 * something somebody can check rather than infer.
 */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number): number {
    const planned = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 2));
    return Math.round(random() * planned);
}

/**
 * Run `operation`, trying again while it fails transiently.
 *
 * The last failure is rethrown as it arrived rather than wrapped, so the caller
 * still sees the SDK's own message and status — which is what the run log ends
 * up quoting, and what somebody reading "500 Internal Server Error" in the
 * admin needs in order to find the 503 underneath it.
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    hooks: Partial<RetryHooks> = {},
): Promise<T> {
    const { sleep, random, onRetry } = { ...defaultHooks, ...hooks };

    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            const lastAttempt = attempt >= policy.attempts;
            if (lastAttempt || !isTransient(error)) throw error;

            const waitMs = backoffMs(attempt + 1, policy, random);
            onRetry({
                attempt,
                of: policy.attempts,
                status: statusOf(error) as number,
                waitMs,
                message: error instanceof Error ? error.message : String(error),
            });
            await sleep(waitMs);
        }
    }
}
