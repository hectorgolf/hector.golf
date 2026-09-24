/**
 * The last standings a visitor's browser saw, kept so the next visit can start
 * from them instead of from an empty board.
 *
 * A leaderboard page is built hours before play and published with whatever
 * standings existed then — during a tournament, usually none. The live island
 * fills the board in, but only after a network round trip through the proxy, so
 * every reload of a page a visitor is reloading precisely *because* play is
 * underway opens on "Live standings begin when play starts". Remembering the
 * last payload turns that into an immediate, honestly timestamped board that the
 * live read then corrects.
 *
 * Nothing here is authoritative. A cached board is a starting picture, so every
 * function fails by returning "no cache": a payload in an unexpected shape, a
 * clock that disagrees, a `localStorage` that throws in a locked-down browser,
 * or standings the page was already published with all mean the island behaves
 * exactly as it did before this module existed.
 *
 * The rows cached are the rows the page displays, on the visitor's own device
 * only. Nothing is written that the page did not already show them.
 */

import type { AppLeaderboardSnapshot } from "@hector/schemas/src/leaderboards/app-payload.ts";

/**
 * Bumped whenever the cached shape changes, as part of the key.
 *
 * A reader only ever finds entries it wrote, so an old entry is not migrated or
 * deleted — it is simply never read again, and the browser evicts it whenever it
 * next needs the room.
 */
const CACHE_VERSION = 1;

const KEY_PREFIX = `hector.live-leaderboard.v${CACHE_VERSION}.`;

/**
 * Where a cached board stops being a useful starting picture.
 *
 * Two days, because that is the shape of the event: a Hector runs over a
 * weekend, and standings seen on Saturday evening are still the right first
 * frame on Sunday morning — and still the right one on Monday, when the last
 * thing a visitor wants is the board they were following replaced by "play has
 * not started". The reader is never misled by a stale board reaching this far,
 * because the status line prints the timestamp it carries; what keeps the limit
 * finite at all is that a board from a tournament long over has nothing to say.
 */
export const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export const liveCacheKey = (eventId: string): string => `${KEY_PREFIX}${eventId}`;

/**
 * The slice of `Storage` this module uses.
 *
 * Narrowed so tests can hand in a plain object, and so it is obvious that
 * nothing here enumerates or clears storage it does not own.
 */
export type StorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

/** A cached snapshot plus the two facts needed to judge whether it is still worth showing. */
type CacheEntry = {
    /** The event the standings belong to, re-checked on read in case a key is ever reused. */
    eventId: string;
    /** When this entry was written, as an ISO 8601 string — the age is measured from here. */
    savedAt: string;
    snapshot: AppLeaderboardSnapshot;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasRowShape = (value: unknown, nameField: "team" | "player"): boolean => {
    if (!isRecord(value)) return false;
    return (
        typeof value[nameField] === "string" &&
        (typeof value.points === "number" || typeof value.points === "string") &&
        typeof value.diff === "string" &&
        typeof value.through === "string"
    );
};

const hasEntryShape = (value: unknown): value is CacheEntry => {
    if (!isRecord(value)) return false;
    if (typeof value.eventId !== "string" || typeof value.savedAt !== "string") return false;
    const snapshot = value.snapshot;
    if (!isRecord(snapshot)) return false;
    return (
        Array.isArray(snapshot.hector) &&
        Array.isArray(snapshot.victor) &&
        snapshot.hector.every((row) => hasRowShape(row, "team")) &&
        snapshot.victor.every((row) => hasRowShape(row, "player"))
    );
};

/**
 * The instant a snapshot describes, as a timestamp.
 *
 * `generatedAt` is upstream's own word for when it produced the standings and is
 * what the status line prints, so it is also what freshness is judged on. It is
 * optional in the payload, and an entry that lacks it falls back to when we
 * stored it — which is within a round trip of the same moment.
 */
const snapshotInstant = (entry: CacheEntry): number => {
    const generated = entry.snapshot.generatedAt ? Date.parse(entry.snapshot.generatedAt) : Number.NaN;
    return Number.isFinite(generated) ? generated : Date.parse(entry.savedAt);
};

export type ReadOptions = {
    /** Now, as a timestamp. Passed in rather than read, so the age rule is testable. */
    now: number;
    /**
     * When the standings the page was published with were read, as an ISO 8601
     * string — the leaderboard file's `updatedAt`.
     *
     * A build that already published fresher standings than the cache has beats
     * the cache: the rendered rows are the better picture, and repainting them
     * with older ones would be a visible step backwards. Absent or unparseable
     * means the page has no published standings to lose.
     */
    renderedAt?: string;
    /** How old a cached board may be and still be shown. */
    maxAgeMs?: number;
};

/**
 * The cached standings for an event, if they are still worth painting.
 *
 * Returns `undefined` for anything doubtful — wrong event, unreadable JSON,
 * unrecognised shape, too old, or older than what the page already shows — and
 * drops an entry it has rejected as too old, since nothing will ever read it.
 */
export const readCachedSnapshot = (
    storage: StorageLike | undefined,
    eventId: string,
    options: ReadOptions,
): AppLeaderboardSnapshot | undefined => {
    if (!storage) return undefined;
    const key = liveCacheKey(eventId);

    let entry: CacheEntry;
    try {
        const raw = storage.getItem(key);
        if (!raw) return undefined;
        const parsed: unknown = JSON.parse(raw);
        if (!hasEntryShape(parsed)) return undefined;
        entry = parsed;
    } catch {
        return undefined;
    }

    if (entry.eventId !== eventId) return undefined;

    const instant = snapshotInstant(entry);
    if (!Number.isFinite(instant)) return undefined;

    // A clock that has moved backwards since the write makes the age negative;
    // that is a reason to distrust the arithmetic, not the standings, so only a
    // genuinely expired entry is dropped.
    const age = options.now - instant;
    const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (age > maxAge) {
        clearCachedSnapshot(storage, eventId);
        return undefined;
    }

    const renderedAt = options.renderedAt ? Date.parse(options.renderedAt) : Number.NaN;
    if (Number.isFinite(renderedAt) && instant <= renderedAt) return undefined;

    return entry.snapshot;
};

/**
 * Remembers a snapshot as the starting picture for this event's next visit.
 *
 * Storage can be unavailable, full, or refuse writes outright; none of that is
 * worth interrupting a live board over, so a failed write is simply a visit that
 * starts from the published page.
 */
export const writeCachedSnapshot = (
    storage: StorageLike | undefined,
    eventId: string,
    snapshot: AppLeaderboardSnapshot,
    now: number,
): void => {
    if (!storage) return;
    const entry: CacheEntry = {
        eventId,
        savedAt: new Date(now).toISOString(),
        snapshot: {
            hector: snapshot.hector,
            victor: snapshot.victor,
            generatedAt: snapshot.generatedAt,
            status: snapshot.status,
        },
    };
    try {
        storage.setItem(liveCacheKey(eventId), JSON.stringify(entry));
    } catch {
        // Nothing to do and nothing to say: the board on screen is unaffected.
    }
};

export const clearCachedSnapshot = (storage: StorageLike | undefined, eventId: string): void => {
    if (!storage) return;
    try {
        storage.removeItem(liveCacheKey(eventId));
    } catch {
        // See above.
    }
};

/**
 * `localStorage`, or nothing if it cannot be touched.
 *
 * Reading the property itself throws in a browser configured to block site
 * data, so even getting hold of it needs the guard.
 */
export const browserStorage = (): StorageLike | undefined => {
    try {
        return window.localStorage ?? undefined;
    } catch {
        return undefined;
    }
};
