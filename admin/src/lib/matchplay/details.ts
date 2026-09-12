import type { MatchplayEvent } from '@hector/schemas/src/events.ts'

/**
 * The part of a tournament a person writes, as opposed to the part playing it
 * produces.
 *
 * The field, the bracket and the status are all consequences of the tournament
 * happening, and each has its own action on the tournament page. These four are
 * just prose and dates, and they stay editable for the life of the event: a name
 * typed wrong or a date moved after the fact is a correction, not a replay.
 *
 * `id` is not here on purpose. It is the event's URL on the public site, so
 * changing it would silently break every link to a tournament that has already
 * been played.
 */
export type EventDetails = Pick<MatchplayEvent, 'name' | 'location' | 'timing' | 'description'>

/**
 * Reads those four out of a submitted form.
 *
 * Shared by the create and the edit page rather than written twice, because the
 * two forms have to agree about trimming and about what an empty box means — and
 * a difference between them would show up as a stray space in a tournament name
 * long after anyone could say which page had typed it.
 *
 * Nothing here validates: the values go to `matchplayEventSchema`, which is the
 * only thing that decides whether an event is well formed.
 */
export function detailsFromForm(values: Record<string, string>): EventDetails {
	return {
		name: values.name?.trim() ?? '',
		location: values.location?.trim() ?? '',
		timing: { start: values.start ?? '', end: values.end ?? '' },
		// An emptied box means the event has no description, not that it has an
		// empty one: the schema leaves the field out, and the public page renders
		// nothing rather than a blank paragraph.
		description: values.description?.trim() || undefined,
	}
}
