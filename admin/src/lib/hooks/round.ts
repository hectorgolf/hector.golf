import { timingSafeEqual } from 'node:crypto'

/**
 * What app.hector.golf tells us, and what we do with it.
 *
 * Split from the route so the two decisions worth pinning — what counts as a
 * valid signal, and who is allowed to send one — can be tested without an HTTP
 * server or a Firestore.
 */

/**
 * The moments app.hector.golf reports.
 *
 * A closed set rather than a free string, because this is the vocabulary of an
 * integration between two systems: a value nobody here recognises is a change
 * on their side that we should notice, not a run we should start anyway. It
 * also makes the run log answer "why did this run" in the words the caller used.
 *
 * `round-started` is included although a round beginning changes no score yet.
 * The board does change: positions reset to the new round's `thru`, and the
 * published page says "1/6" where it said "F". One signal per boundary is also
 * a contract that is easy for the other side to honour — "tell us when a round
 * opens and when it closes" needs no judgement from them about which of those
 * we care about.
 */
export const ROUND_PHASES = ['round-started', 'round-ended', 'event-ended'] as const

export type RoundPhase = (typeof ROUND_PHASES)[number]

export type RoundSignal = {
    phase: RoundPhase
    /** The event the caller says this is about. Recorded, never acted on. */
    event?: string
    /** The round number the caller says this is about. Recorded, never acted on. */
    round?: number
}

export type SignalOutcome = { ok: true; signal: RoundSignal } | { ok: false; detail: string }

/**
 * A signal read out of a request body.
 *
 * ## Why `event` and `round` are recorded rather than obeyed
 *
 * Because obeying them would be the only thing on this endpoint that a caller
 * could steer, and it would buy nothing. What the run does is decided by the
 * repository: `jobs/leaderboards.ts` finds every Hector being played whose
 * standings live on app.hector.golf and republishes those. An `event` parameter
 * could only narrow that set — and narrowing it wrongly, from outside, means a
 * tournament that silently stops updating.
 *
 * They are kept because the run log is read by people: "HECTOR2026 round 3
 * ended" is the sentence that explains a commit six months later, and a run
 * that only says "something happened" explains nothing. `docs/current/` calls
 * this the difference between a log and a record.
 *
 * So they are validated for shape — enough that a hostile value cannot reach a
 * log line or a commit message as something other than a short string — and
 * then treated as prose.
 */
export function readSignal(body: unknown): SignalOutcome {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { ok: false, detail: 'expected a JSON object' }
    }

    const { phase, event, round } = body as Record<string, unknown>

    if (typeof phase !== 'string' || !ROUND_PHASES.includes(phase as RoundPhase)) {
        return { ok: false, detail: `phase must be one of ${ROUND_PHASES.join(', ')}` }
    }

    // Bounded and pattern-checked for the same reason `sources.ts` bounds an
    // event id: this reaches a log line and a run-log document, and "a string
    // the caller sent" is not a length or an alphabet.
    if (event !== undefined && (typeof event !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event))) {
        return { ok: false, detail: 'event must be a short identifier' }
    }

    if (round !== undefined && (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 99)) {
        return { ok: false, detail: 'round must be a whole number between 1 and 99' }
    }

    return { ok: true, signal: { phase: phase as RoundPhase, event, round } }
}

/**
 * How the run log names the caller.
 *
 * The prefix says which door this came through, because the same job is also
 * started by the schedule, by an admin pressing Run now, and by the relay
 * function — and a run log where those are indistinguishable cannot answer why
 * a leaderboard moved at 14:32.
 */
export function attribution(signal: RoundSignal): string {
    const about = [signal.event, signal.round === undefined ? undefined : `round ${signal.round}`]
        .filter(Boolean)
        .join(' ')
    return about ? `app.hector.golf (${signal.phase}: ${about})` : `app.hector.golf (${signal.phase})`
}

/**
 * Whether the presented key is the configured one, in constant time.
 *
 * `timingSafeEqual` throws on a length mismatch, so lengths are compared first,
 * which leaks the length of the key and nothing else. The same reasoning as in
 * `RequestLeaderboardUpdate`, and for the same reason: this endpoint is open to
 * the internet by design, so a `!==` is a few thousand requests away from
 * leaking rather more than a length.
 */
export function keyMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}
