import { describe, expect, it } from "vitest";

import type { AppLeaderboardSnapshot } from "@hector/schemas/src/leaderboards/app-payload.ts";
import {
    DEFAULT_MAX_AGE_MS,
    clearCachedSnapshot,
    liveCacheKey,
    readCachedSnapshot,
    type StorageLike,
    writeCachedSnapshot,
} from "../../../src/code/leaderboards/live-cache.ts";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");

const SNAPSHOT: AppLeaderboardSnapshot = {
    generatedAt: "2026-09-25T11:55:00.000Z",
    status: "live",
    hector: [
        { team: "Lasse K & Toni M", points: 71, diff: "", through: "1/3" },
        { team: "Jari K & Sami H", points: 74.5, diff: "+3.5", through: "1/3" },
    ],
    victor: [{ player: "Lasse K", points: 36, diff: "", through: "1/3" }],
};

/** A `Storage` stand-in that records nothing but what was put in it. */
const fakeStorage = (initial: Record<string, string> = {}): StorageLike & { items: Record<string, string> } => {
    const items = { ...initial };
    return {
        items,
        getItem: (key) => items[key] ?? null,
        setItem: (key, value) => {
            items[key] = value;
        },
        removeItem: (key) => {
            delete items[key];
        },
    };
};

/** A storage that refuses every operation, as a locked-down browser's does. */
const hostileStorage = (): StorageLike => ({
    getItem: () => {
        throw new Error("denied");
    },
    setItem: () => {
        throw new Error("denied");
    },
    removeItem: () => {
        throw new Error("denied");
    },
});

const storageHolding = (snapshot: AppLeaderboardSnapshot, savedAt = "2026-09-25T11:55:02.000Z", eventId = "HECTOR2026") => {
    return fakeStorage({ [liveCacheKey(eventId)]: JSON.stringify({ eventId, savedAt, snapshot }) });
};

describe("the live leaderboard's client-side cache", () => {
    it("reads back what it wrote", () => {
        const storage = fakeStorage();
        writeCachedSnapshot(storage, "HECTOR2026", SNAPSHOT, NOW);
        expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toEqual(SNAPSHOT);
    });

    it("keys by event, so one event's standings never appear on another's board", () => {
        const storage = fakeStorage();
        writeCachedSnapshot(storage, "HECTOR2026", SNAPSHOT, NOW);
        expect(readCachedSnapshot(storage, "HECTOR2025", { now: NOW })).toBeUndefined();
    });

    it("has nothing to say when nothing was ever cached", () => {
        expect(readCachedSnapshot(fakeStorage(), "HECTOR2026", { now: NOW })).toBeUndefined();
    });

    it("forgets an event on request", () => {
        const storage = fakeStorage();
        writeCachedSnapshot(storage, "HECTOR2026", SNAPSHOT, NOW);
        clearCachedSnapshot(storage, "HECTOR2026");
        expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toBeUndefined();
    });

    /**
     * A cached board is a starting picture, never a source of truth, so every
     * doubt resolves to "no cache" and the page keeps what the build published.
     */
    describe("declining to paint", () => {
        it("declines an entry past its age limit, and drops it", () => {
            const storage = storageHolding(SNAPSHOT);
            const later = Date.parse(SNAPSHOT.generatedAt!) + DEFAULT_MAX_AGE_MS + 1;
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: later })).toBeUndefined();
            expect(storage.items).toEqual({});
        });

        it("still paints an entry right up to the limit", () => {
            const storage = storageHolding(SNAPSHOT);
            const later = Date.parse(SNAPSHOT.generatedAt!) + DEFAULT_MAX_AGE_MS;
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: later })).toEqual(SNAPSHOT);
        });

        it("honours a caller's own age limit", () => {
            const storage = storageHolding(SNAPSHOT);
            const tenMinutesLater = Date.parse(SNAPSHOT.generatedAt!) + 10 * 60 * 1000;
            const options = { now: tenMinutesLater, maxAgeMs: 5 * 60 * 1000 };
            expect(readCachedSnapshot(storage, "HECTOR2026", options)).toBeUndefined();
        });

        it("declines standings the page was published with more recently", () => {
            const storage = storageHolding(SNAPSHOT);
            const options = { now: NOW, renderedAt: "2026-09-25T11:58:00.000Z" };
            expect(readCachedSnapshot(storage, "HECTOR2026", options)).toBeUndefined();
        });

        it("paints standings newer than the ones the page was published with", () => {
            const storage = storageHolding(SNAPSHOT);
            const options = { now: NOW, renderedAt: "2026-09-25T09:00:00.000Z" };
            expect(readCachedSnapshot(storage, "HECTOR2026", options)).toEqual(SNAPSHOT);
        });

        it("paints when the page carries no published standings at all", () => {
            const storage = storageHolding(SNAPSHOT);
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW, renderedAt: undefined })).toEqual(SNAPSHOT);
        });

        it("declines an entry stored against a different event id", () => {
            const storage = fakeStorage({
                [liveCacheKey("HECTOR2026")]: JSON.stringify({
                    eventId: "HECTOR2025",
                    savedAt: "2026-09-25T11:55:02.000Z",
                    snapshot: SNAPSHOT,
                }),
            });
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toBeUndefined();
        });

        it("declines anything that is not JSON", () => {
            const storage = fakeStorage({ [liveCacheKey("HECTOR2026")]: "not json" });
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toBeUndefined();
        });

        it("declines an entry whose rows are not rows", () => {
            const storage = fakeStorage({
                [liveCacheKey("HECTOR2026")]: JSON.stringify({
                    eventId: "HECTOR2026",
                    savedAt: "2026-09-25T11:55:02.000Z",
                    snapshot: { hector: [{ team: "Lasse K & Toni M" }], victor: [] },
                }),
            });
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toBeUndefined();
        });

        it("declines an entry with no timestamp it can age", () => {
            const storage = fakeStorage({
                [liveCacheKey("HECTOR2026")]: JSON.stringify({
                    eventId: "HECTOR2026",
                    savedAt: "whenever",
                    snapshot: { hector: [], victor: [] },
                }),
            });
            expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW })).toBeUndefined();
        });
    });

    /**
     * A snapshot may arrive without `generatedAt`; the write is then within a
     * round trip of the standings it holds, which is close enough to age it by.
     */
    it("ages an entry by when it was stored when upstream sent no timestamp", () => {
        const storage = fakeStorage();
        const undated: AppLeaderboardSnapshot = { ...SNAPSHOT, generatedAt: undefined };
        writeCachedSnapshot(storage, "HECTOR2026", undated, NOW);
        expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW + 1000 })).toEqual(undated);
        expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW + DEFAULT_MAX_AGE_MS + 1 })).toBeUndefined();
    });

    /**
     * A clock that moved backwards makes the age negative. That is a reason to
     * distrust the arithmetic, not the standings — and the status line prints the
     * timestamp either way, so the reader can judge for themselves.
     */
    it("paints an entry that appears to come from the future", () => {
        const storage = storageHolding(SNAPSHOT);
        expect(readCachedSnapshot(storage, "HECTOR2026", { now: NOW - 60 * 60 * 1000 })).toEqual(SNAPSHOT);
    });

    describe("when the browser will not cooperate", () => {
        it("reads nothing rather than throwing", () => {
            expect(readCachedSnapshot(hostileStorage(), "HECTOR2026", { now: NOW })).toBeUndefined();
        });

        it("writes nothing rather than throwing", () => {
            expect(() => writeCachedSnapshot(hostileStorage(), "HECTOR2026", SNAPSHOT, NOW)).not.toThrow();
        });

        it("clears nothing rather than throwing", () => {
            expect(() => clearCachedSnapshot(hostileStorage(), "HECTOR2026")).not.toThrow();
        });

        it("does nothing at all without a storage to use", () => {
            expect(readCachedSnapshot(undefined, "HECTOR2026", { now: NOW })).toBeUndefined();
            expect(() => writeCachedSnapshot(undefined, "HECTOR2026", SNAPSHOT, NOW)).not.toThrow();
            expect(() => clearCachedSnapshot(undefined, "HECTOR2026")).not.toThrow();
        });
    });
});
