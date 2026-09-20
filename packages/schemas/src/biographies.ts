import { parseIsoDate, type IsoDate } from './dates.ts';
import { type EventTiming, type HectorEvent } from './events.ts';
import { type Player } from './players.ts';

/**
 * The players a run may rewrite, and the ones a lock is holding.
 *
 * Three lists rather than one, so a caller can say who it left alone and why.
 * `alreadyPublished` is the phrasing a locked biography still contributes to the
 * generator's "do not reuse this" context; see `biography-lock.test.ts` for why
 * dropping it would let a run echo a published sentence.
 */
export const biographiesToRegenerate = (
    players: Array<Player>,
): { regenerate: Array<Player>; locked: Array<Player>; alreadyPublished: Array<string> } => {
    const locked = players.filter((p) => p.biographyLocked === true);
    return {
        regenerate: players.filter((p) => !p.biographyLocked),
        locked,
        alreadyPublished: locked.flatMap((player) => player.biography ?? []),
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
