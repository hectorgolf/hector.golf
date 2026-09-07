/** Base class for everything this SDK throws, so callers can catch one type. */
export class MScorecardError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** A non-2xx response, or a 2xx response whose body was not the JSON we expected. */
export class MScorecardHttpError extends MScorecardError {
    constructor(
        message: string,
        readonly status: number,
        readonly method: string,
        readonly url: string,
        readonly body: string,
    ) {
        super(`${message} (${method} ${url} -> HTTP ${status})`);
    }
}

/** No credentials, or the server rejected the ones we had. */
export class MScorecardAuthError extends MScorecardError {}

/**
 * The round's `ts` version token was stale or missing.
 *
 * Every write to a round has to echo the `ts` from the previous response on that
 * round. If two clients write to the same round, one of them loses the race and
 * has to re-read the round before retrying.
 */
export class MScorecardConflictError extends MScorecardError {}

/**
 * The round is locked against edits.
 *
 * A write to such a round is *accepted* — HTTP 200, a fresh `ts` — and answered with
 * `noEdit: 1` instead of an error, so a client that only checks the status code sees
 * a success and loses the write. Rounds already processed for handicap purposes come
 * back this way.
 */
export class MScorecardNotEditableError extends MScorecardError {}
