import { parseIsoDate, type IsoDate } from './dates.ts';
import { type EventTiming, type HectorEvent } from './events.ts';
import { type Player } from './players.ts';

/**
 * The players a run should draft for, and the ones it is leaving alone.
 *
 * ## What decides it, and what stopped deciding it
 *
 * Staleness is now a question about the *facts*: a biography is current when the
 * things the generator would be told about that player are the things it was
 * told when the text was written. The caller answers that — see
 * `promptFingerprint` in the admin — and this only sorts the roster by the
 * answer.
 *
 * It used to be a date, compared against the day the last Hector finished, and
 * that was a proxy for this question rather than the question. It said nothing
 * about a player who joined the field, won something, changed clubs or had a
 * prompt hint added, and it said "stale" to all forty-five whenever the
 * comparison moved even if nothing about any of them had changed.
 *
 * ## The lock no longer holds a player back, and that is a real change
 *
 * `biographyLocked` used to exclude a player outright, because a run *published*
 * what it generated and a lock was the only thing standing between a scheduled
 * job and somebody's hand-written paragraph. `biography-lock.test.ts` exists
 * about exactly that failure.
 *
 * A run drafts now. Nothing it produces reaches a player record without somebody
 * pressing a button next to the current text, so the protection the lock was
 * providing is provided by the review page instead — and being locked is a poor
 * reason to leave a biography factually wrong. A hand-written paragraph that
 * calls a finished Hector "upcoming" is as wrong as a generated one, and its
 * author is the person best placed to decide what to do about it.
 *
 * So the lock is reported rather than obeyed: the run log names who it is about
 * to offer a draft to, and the review page warns before anything replaces their
 * words. What it still does is set the tone of that warning, which is the part
 * that was ever about consent.
 */
export const biographiesToRegenerate = (
    players: Array<Player>,
    /**
     * Whether this player's biography already reflects the current facts.
     *
     * A predicate rather than a value because the comparison needs the whole
     * generator input — the events, the club names, the day — which this module
     * has no business assembling. `admin/src/lib/jobs/biography-fingerprint.ts`
     * is where the question is actually answered.
     *
     * Absent means "nothing is current", which is what a caller with no way to
     * tell should get: it drafts for everybody rather than silently skipping a
     * roster it cannot vouch for.
     */
    isUpToDate: (player: Player) => boolean = () => false,
): {
    /** Everyone whose biography no longer matches the facts, locked or not. */
    regenerate: Array<Player>;
    /** The subset of `regenerate` whose text somebody claimed by editing it. */
    claimed: Array<Player>;
    /** Everyone whose biography still matches. */
    upToDate: Array<Player>;
    /** What the generator is told not to echo; see below. */
    alreadyPublished: Array<string>;
} => {
    const upToDate = players.filter(isUpToDate);
    const regenerate = players.filter((player) => !isUpToDate(player));

    return {
        regenerate,
        claimed: regenerate.filter((player) => player.biographyLocked === true),
        upToDate,
        /*
         * The phrasing a run is told not to reuse, and it is drawn from the
         * players this run is *not* rewriting.
         *
         * Every one of those biographies is on the public page beside whatever
         * the run writes, so leaving them out lets the model echo a published
         * sentence under somebody else's name — the failure
         * `biography-lock.test.ts` exists about. The players being drafted for
         * contribute their new text instead, as the run produces it.
         */
        alreadyPublished: upToDate.flatMap((player) => player.biography ?? []),
    };
};

/** An event as the biography generator names it. */
export type EventNameAndYear = { name: string; year: number };

export type NextEvent = EventNameAndYear & { participates: boolean };

/** What `GeneratePlayerBiography` is given. Its half of the contract is `common.ts`. */
export type PlayerBiographyInput = {
    name: string;
    gender: 'male' | 'female';
    homeClub: string;
    miscellaneousDetails: string[];
    previousAppearances: EventNameAndYear[];
    hectorWins: EventNameAndYear[];
    victorWins: EventNameAndYear[];
    allPastEvents: EventNameAndYear[];
    nextEvent: NextEvent | undefined;
    retired: boolean;
    otherGeneratedBiographies: string[];
};

/** How many Hectors a player can miss before the prompt calls them retired. */
export const RETIRED_AFTER_ABSENT_EVENTS = 7;

export function eventNameAndYear(event: { name: string; timing: EventTiming }): EventNameAndYear {
    return { name: event.name, year: parseIsoDate(event.timing.end).getFullYear() };
}

/** Played in it, or won something at it — a winner is an appearance either way. */
export function playerParticipatedInEvent(player: Player, event: HectorEvent): boolean {
    return (
        event.participants.includes(player.id) ||
        event.results?.winners?.hector?.includes(player.id) ||
        event.results?.winners?.victor?.includes(player.id) ||
        false
    );
}

export type BiographyContext = {
    /** Every Hector event, in any order — this sorts them. */
    hectorEvents: HectorEvent[];
    /** Today, so "past" and "upcoming" are decided by the caller's clock. */
    today: IsoDate;
    /** The club's full name, resolved by the caller from its abbreviation. */
    homeClub: string;
    /** Text already published or generated this run, for the do-not-echo context. */
    otherGeneratedBiographies: string[];
};

/**
 * What the generator is told about one player.
 *
 * **Sorted by date here, deliberately.** This came from
 * `update-player-biographies.ts`, where the events arrived in `glob` order —
 * which that package's README describes as an indeterminate filesystem walk. The
 * code then read `pastAppearances[0]` as the player's *last* appearance, which
 * under the alphabetical order it happened to get was their *first*. `retired`
 * therefore meant "debuted in 2022 or later", and disagreed with the dates for
 * 15 of the 45 players: somebody who last played in 2014 was described to the
 * model as still active, and somebody who played in 2025 as retired.
 *
 * A player who has never appeared is not retired either, which the old
 * expression also got wrong — it fell back to the whole event count, so a
 * debutant in the upcoming Hector was introduced as having retired from it.
 *
 * See `biography-input.test.ts`.
 */
export function playerBiographyInput(player: Player, context: BiographyContext): PlayerBiographyInput {
    const chronological = [...context.hectorEvents].sort((a, b) => a.timing.end.localeCompare(b.timing.end));
    const past = chronological.filter((event) => event.timing.end < context.today);
    const appearances = past.filter((event) => playerParticipatedInEvent(player, event));

    const lastAppearance = appearances[appearances.length - 1];
    const eventsSinceLastAppearance = lastAppearance
        ? past.length - 1 - past.indexOf(lastAppearance)
        : past.length;

    const nextEvent = chronological
        .filter((event) => event.timing.start >= context.today)
        .filter((event) => event.participants.length > 0)[0];

    return {
        name: player.name.first,
        gender: player.gender || 'male',
        homeClub: context.homeClub,
        miscellaneousDetails: player.misc || [],
        previousAppearances: appearances.map(eventNameAndYear),
        hectorWins: chronological
            .filter((e) => e.results?.winners?.hector?.includes(player.id))
            .map(eventNameAndYear),
        victorWins: chronological
            .filter((e) => e.results?.winners?.victor?.includes(player.id))
            .map(eventNameAndYear),
        allPastEvents: past.map(eventNameAndYear),
        nextEvent: nextEvent
            ? { ...eventNameAndYear(nextEvent), participates: nextEvent.participants.includes(player.id) }
            : undefined,
        // Never having played is not retirement; it is not having started.
        retired: appearances.length > 0 && eventsSinceLastAppearance > RETIRED_AFTER_ABSENT_EVENTS,
        otherGeneratedBiographies: context.otherGeneratedBiographies,
    };
}
