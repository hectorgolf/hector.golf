import { DateTime } from 'luxon';

import { type Event, type HectorEvent } from './events.ts';
import { getPlayerHandicapFromHistory, type HandicapHistoryEntry } from './handicaps.ts';
import { type Player } from './players.ts';

/** The hour of the first morning at which a Hector's buckets stop moving, local to the event. */
export const BUCKETS_FREEZE_AT_HOUR = 8;

/** The moment an event's buckets stop moving, or undefined if there is no saying. */
export function bucketsFreezeAt(event: Event | undefined): DateTime | undefined {
    if (!event) return undefined;
    const zone = event.timing.timezone ?? 'UTC';
    const hour = event.timing.timezone ? BUCKETS_FREEZE_AT_HOUR : 0;
    const freezesAt = DateTime.fromISO(event.timing.start, { zone }).set({ hour });
    return freezesAt.isValid ? freezesAt : undefined;
}

/** True while an event's buckets may still be recomputed. */
export function bucketsAreOpen(event: Event | undefined, now: Date = new Date()): boolean {
    const freezesAt = bucketsFreezeAt(event);
    if (!freezesAt) return false;
    return now.getTime() < freezesAt.toMillis();
}

/** True if the event has anybody to split. */
export function hasParticipants(event: Event | undefined): boolean {
    return (event?.participants?.length || 0) > 0;
}

/**
 * How a player's name is rendered for the sort's last tiebreak.
 *
 * A parameter because the site's renderer shortens last names for privacy, which it can
 * only do by reading the whole roster. See `bucketing.test.ts`.
 */
export type NameOf = (player: Player) => string;

/** Lowest handicap first, then the faster riser, then by name. */
export const bucketingOrder =
    (history: Array<HandicapHistoryEntry>, nameOf: NameOf) =>
    (p1: Player, p2: Player): number => {
        const player1Handicap = getPlayerHandicapFromHistory(p1.id, history);
        const player2Handicap = getPlayerHandicapFromHistory(p2.id, history);
        const hcpDifference = (player1Handicap ?? 0) - (player2Handicap ?? 0);
        if (hcpDifference !== 0) {
            return hcpDifference;
        }
        const player1PreviousHcp = getPlayerHandicapFromHistory(p1.id, history, -1);
        const player2PreviousHcp = getPlayerHandicapFromHistory(p2.id, history, -1);
        const previousHcpDifference = (player1PreviousHcp ?? 0) - (player2PreviousHcp ?? 0);
        if (previousHcpDifference !== 0) {
            return -1 * previousHcpDifference;
        }
        return nameOf(p1).localeCompare(nameOf(p2));
    };

/**
 * The Hectors a run may redraw the split for, and the ones a lock is holding.
 *
 * Two lists rather than one, so a caller can say which events it left alone and why.
 * See `bucket-lock.test.ts` for why the clock and the lock stay separate questions.
 */
export const bucketsToRecompute = (
    events: Array<HectorEvent>,
    now: Date = new Date(),
): { recompute: Array<HectorEvent>; locked: Array<HectorEvent> } => {
    const open = events.filter(hasParticipants).filter((e) => bucketsAreOpen(e, now));
    return {
        recompute: open.filter((e) => !e.bucketsLocked),
        locked: open.filter((e) => e.bucketsLocked === true),
    };
};

/** Two halves of an already-sorted field, the larger first when it is odd. */
export const splitIntoBuckets = <T>(participants: ReadonlyArray<T>): [Array<T>, Array<T>] => {
    const first = participants.slice(0, Math.ceil(participants.length / 2));
    return [first, participants.slice(first.length)];
};
