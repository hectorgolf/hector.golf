import type { GolfClub, HandicapSource } from "./handicap-source-api.ts";

/**
 * A WiseGolf stand-in whose handicaps move, for a laptop.
 *
 * The third of the local stand-ins, after `admin/scripts/dev-iap.ts` for IAP and
 * `admin/scripts/fake-github.ts` for GitHub, and the one that finally lets the
 * handicaps job finish locally: with no WiseGolf credentials a dev run ends at
 * "no handicap source answered for any of 45 players", which is the sweep giving
 * up before the interesting part.
 *
 * ## Why an implementation rather than a fake server
 *
 * `fake-github.ts` stands in at the HTTP layer, so that the real client's own
 * parsing is exercised. The same trick is a much worse trade here. WiseGolf is
 * three hosts — `api.wisegolfclub.fi` for auth and clubs, `api.ringsidegolf.fi`
 * for players, `app.wisegolf.fi` as the origin — none of them ours, none of them
 * documented, and all of them free to change without telling us. Reproducing
 * three third-party payload shapes would be a large piece of guesswork whose
 * fidelity nobody could check, and it would go stale silently.
 *
 * `HandicapSource` is the seam the rest of this repository already uses: three
 * methods, ours, and already implemented twice — the real session and
 * `NullHandicapSource`, which this sits beside as a second deliberate non-real
 * implementation. And the thing worth simulating is not the wire format. It is a
 * handicap that *moves*, which is what the reconcile, the change list and the
 * append-only backup all exist to cope with and none of which a static fixture
 * ever exercises.
 *
 * ## How the drift works, and why there is no timer
 *
 * The handicap at any moment is a pure function of (roster, seed, elapsed time).
 * There is no interval, no mutable state and nothing to have drifted out of step
 * with the clock: a tick index is derived from how long the source has been
 * alive, and the walk is replayed from tick zero each time it is asked.
 *
 * Replaying sounds wasteful and is not — a tick is five minutes, so a full day
 * of a dev server is under three hundred steps of integer arithmetic — and it
 * buys two things worth more than the cycles. The same seed gives the same
 * sequence, so a confusing run can be re-run. And it is a pure function, so the
 * rules below are testable as arithmetic rather than by waiting five minutes.
 */

/** One player as the stand-in knows them: who they are, and where they started. */
export type RosterEntry = {
    firstName: string;
    lastName: string;
    club: string;
    /** The handicap the drift departs from, and never strays far from. */
    handicap: number;
};

/**
 * Five minutes, the interval on which some handicaps move — and the default
 * rather than the rule, because five minutes is the wrong number for the two
 * things this gets used for.
 *
 * It is right for leaving a dev server running and coming back to a roster that
 * has moved the way a real one does. It is badly wrong for the first ten minutes
 * of using the stand-in at all, where somebody presses the button, sees no
 * changes, and reasonably concludes the thing is broken — the drift is invisible
 * for the entire length of their patience. `WISEGOLF_STAND_IN_TICK` is for that
 * case; see `stand-in.ts`.
 */
export const TICK_MS = 5 * 60 * 1000;

/**
 * How much of the roster moves on a tick, as a fraction.
 *
 * Note the arithmetic if you are changing the roster size: this is a
 * *proportion*, so a roster of 24 moves two or three players per tick, not four.
 * Four would be nearer 0.17.
 */
export const MOVERS_PER_TICK = 0.1;

/**
 * How far a handicap may stray from where it started, in either direction.
 *
 * The walk is clamped rather than wrapped or re-centred, so a player who drifts
 * to the edge stays there until the walk turns back. What this guarantees is the
 * property worth having: a stand-in left running overnight still holds handicaps
 * that look like the roster it was given, rather than a random field.
 */
export const MAX_DRIFT = 2.0;

/** The largest single step, before clamping. */
const MAX_STEP = 0.5;

/** Handicaps carry one decimal, and arithmetic here must not invent more. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** A player's key, matched the way `getPlayerHandicap` is asked. */
const keyOf = (firstName: string, lastName: string): string =>
    `${firstName.trim().toLowerCase()} ${lastName.trim().toLowerCase()}`;

/** 32 bits out of a string, so a seed can be a word. */
function hashOf(text: string): number {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** mulberry32: small, fast, and good enough for handicaps that wobble. */
function randomFrom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
        drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
        return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Which players move on a given tick.
 *
 * A shuffle taken from the tick's own seed rather than an independent draw per
 * player, so that the count is exactly right every time instead of right on
 * average. A tick that moved nobody, or everybody, would be indistinguishable
 * from the stand-in being broken.
 */
export function moversOnTick(roster: readonly RosterEntry[], tick: number, seed: string): Set<string> {
    const howMany = Math.max(1, Math.round(roster.length * MOVERS_PER_TICK));
    const random = randomFrom(hashOf(`${seed}:tick:${tick}`));

    const keys = roster.map((entry) => keyOf(entry.firstName, entry.lastName));
    // Fisher-Yates, as far as we need it.
    for (let index = keys.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [keys[index], keys[swap]] = [keys[swap]!, keys[index]!];
    }
    return new Set(keys.slice(0, Math.min(howMany, keys.length)));
}

/**
 * Where the whole roster's handicaps have got to after `tick` ticks.
 *
 * The whole roster at once, deliberately, because the expensive part is deciding
 * *who* moves and that answer is the same for everybody: one shuffle per tick,
 * rather than one per player per tick. Done the other way round this is
 * quadratic in the roster and it showed — a thousand ticks of twenty-four
 * players took ten seconds, which is a stand-in that makes a sweep slower than
 * the real WiseGolf.
 *
 * Replayed from the start rather than remembered, which is what makes this a
 * function of the clock rather than of whatever happened to have run.
 */
export function driftedAfter(roster: readonly RosterEntry[], tick: number, seed: string): Map<string, number> {
    const current = new Map<string, number>();
    const bounds = new Map<string, [number, number]>();
    for (const entry of roster) {
        const key = keyOf(entry.firstName, entry.lastName);
        current.set(key, entry.handicap);
        bounds.set(key, [entry.handicap - MAX_DRIFT, entry.handicap + MAX_DRIFT]);
    }

    for (let step = 1; step <= tick; step += 1) {
        for (const key of moversOnTick(roster, step, seed)) {
            const [lowest, highest] = bounds.get(key)!;
            const random = randomFrom(hashOf(`${seed}:${key}:${step}`));
            // Uniform in [-MAX_STEP, +MAX_STEP], to one decimal.
            const delta = round1((random() * 2 - 1) * MAX_STEP);
            current.set(key, round1(Math.min(highest, Math.max(lowest, current.get(key)! + delta))));
        }
    }
    return current;
}

/** One player's handicap after `tick` ticks. Convenience over `driftedAfter`. */
export function handicapAfter(entry: RosterEntry, roster: readonly RosterEntry[], tick: number, seed: string): number {
    return driftedAfter(roster, tick, seed).get(keyOf(entry.firstName, entry.lastName)) ?? entry.handicap;
}

export type DriftingOptions = {
    roster: readonly RosterEntry[];
    /** Same seed, same sequence. */
    seed?: string;
    /** Injected so the tests do not have to wait five minutes. */
    now?: () => number;
    /** What tick zero is. Defaults to when the source was made. */
    startedAt?: number;
    /** How long a tick lasts. Defaults to `TICK_MS`. */
    tickMs?: number;
};

/**
 * The stand-in itself.
 *
 * `resolveClubMembership` and `getClubs` answer from the roster rather than
 * inventing anything: the clubs that exist are the clubs the given players play
 * for, which is what `update-player-club-memberships.ts` would find if the
 * roster were real.
 */
export class DriftingHandicapSource implements HandicapSource {
    readonly name = "WiseGolf (stand-in, drifting)";

    private readonly roster: readonly RosterEntry[];
    private readonly seed: string;
    private readonly now: () => number;
    private readonly startedAt: number;
    private readonly tickMs: number;

    constructor(options: DriftingOptions) {
        this.roster = options.roster;
        this.seed = options.seed ?? "hector";
        this.now = options.now ?? (() => Date.now());
        this.startedAt = options.startedAt ?? this.now();
        this.tickMs = options.tickMs ?? TICK_MS;
    }

    /** When the next handicaps move, as a count of milliseconds from now. */
    msUntilNextTick(): number {
        const elapsed = Math.max(0, this.now() - this.startedAt);
        return this.tickMs - (elapsed % this.tickMs);
    }

    /** How many ticks have gone by. Never negative. */
    tick(): number {
        return Math.max(0, Math.floor((this.now() - this.startedAt) / this.tickMs));
    }

    /**
     * The roster as it stands, computed once per tick.
     *
     * A sweep asks about every player in turn and the walk is the same walk for
     * all of them, so without this each of twenty-four questions replays every
     * tick since the server started.
     */
    private cached?: { tick: number; handicaps: Map<string, number> };

    private handicaps(): Map<string, number> {
        const tick = this.tick();
        if (this.cached?.tick !== tick) {
            this.cached = { tick, handicaps: driftedAfter(this.roster, tick, this.seed) };
        }
        return this.cached.handicaps;
    }

    private find(firstName: string, lastName: string): RosterEntry | undefined {
        const wanted = keyOf(firstName, lastName);
        return this.roster.find((entry) => keyOf(entry.firstName, entry.lastName) === wanted);
    }

    async getPlayerHandicap(
        firstName: string,
        lastName: string,
        _clubNameOrAbbreviation: string,
    ): Promise<number | undefined> {
        const entry = this.find(firstName, lastName);
        // Undefined rather than a guess, the way a real source answers for
        // somebody it has never heard of — which is what the sweep's `skipped`
        // list is for, and worth being able to see locally.
        if (!entry) return undefined;
        return this.handicaps().get(keyOf(entry.firstName, entry.lastName));
    }

    async resolveClubMembership(firstName: string, lastName: string): Promise<GolfClub[]> {
        const entry = this.find(firstName, lastName);
        if (!entry) return [];
        return [clubOf(entry.club)];
    }

    async getClubs(): Promise<GolfClub[]> {
        const names = [...new Set(this.roster.map((entry) => entry.club))].sort();
        return names.map(clubOf);
    }
}

/**
 * A club, from the abbreviation the roster carries.
 *
 * The player files hold only the short form ("VGC"), so the name is the same
 * string. Nothing in the handicaps job reads the long name, and inventing one
 * would be a detail that looks authoritative and is not.
 */
const clubOf = (abbreviation: string): GolfClub => ({
    name: abbreviation,
    abbreviation,
    sources: [{ name: "stand-in", id: abbreviation }],
});
