import eventsData from '../data/events.json';
import { type Event, genericEventSchema as EventSchema, type MatchplayEvent, type MatchplayResults, type MatchplayMatch, type HectorEvent, type FinnkampenEvent } from '../schemas/events';

import coursesData from '../data/courses.json';
import { type Course, schema as CourseSchema } from '../schemas/courses';


export function getAllEventIds(providedFilter?: (e: Event) => boolean): Array<string> {
    return getAllEvents(providedFilter).map((record => record.id))
}

export function getAllEvents(providedFilter?: (e: Event) => boolean): Array<Event> {
    const eventFilter = (event: Event): boolean => {
        return !event.ignore && (providedFilter ? providedFilter(event) : true)
    }
    return eventsData
        .filter(record => eventFilter(record as Event))
        .map(record => getEventById(record.id))
        .filter(record => !!record) as Array<Event>;
}

export function getAllEventsGroupedByChronology(): { ongoing: Array<Event>, upcoming: Array<Event>, past: Array<Event> } {
    const isoDate = (date: Date|undefined): string => date?.toISOString()?.slice(0, 10) || '';
    const isFinishedMatchplayEvent = (event: Event): boolean => !!(event.format === 'matchplay' && (event as MatchplayEvent).results?.winners?.matchplay)

    const pastEvents: Array<Event> = []
    const ongoingEvents: Array<Event> = []
    const upcomingEvents: Array<Event> = []
    getAllEvents().forEach(event => {
        const range = parseEventDateRange(event.date) || { startDate: undefined, endDate: undefined };
        const {startDate, endDate} = range
        const today = isoDate(new Date())
        const isFuture = startDate && isoDate(startDate) >= today
        const isPast = endDate && (isoDate(endDate) < today || isFinishedMatchplayEvent(event))
        const isOngoing = !isFuture && !isPast
        if (isFuture) {
            upcomingEvents.push(event)
        } else if (isPast) {
            pastEvents.push(event)
        } else if (isOngoing) {
            ongoingEvents.push(event)
        } else {
            console.warn(`How is this possible? An event is neither past, ongoing, nor upcoming: ${JSON.stringify(event, null, 2)}`)
        }
    })
    return { ongoing: ongoingEvents, upcoming: upcomingEvents, past: pastEvents }
}

const populateMissingParticipants = (event: Event): Event => {
    // If the event has an empty list of participants, try to populate it from
    // the event's results object (teams of a team event or the matches of
    // a matchplay event)
    if (event.participants.length === 0 && event.results) {
        if (event.format === 'matchplay') {
            const results: MatchplayResults = (event as MatchplayEvent).results as MatchplayResults
            results.bracket.flatMap(round => round.matches).forEach(match => {
                if (match.left && !event.participants.includes(match.left)) event.participants.push(match.left)
                if (match.right && !event.participants.includes(match.right)) event.participants.push(match.right)
            })
        } else if (event.format === 'hector') {
            const results = (event as HectorEvent).results
            const teams = results?.teams || []
            teams.flatMap(team => team.players).forEach(player => {
                if (!event.participants.includes(player)) event.participants.push(player)
            })
        } else if (event.format === 'finnkampen') {
            const results = (event as FinnkampenEvent).results
            const teams = (results?.teams || [])
            teams.flatMap(team => team.players).forEach(player => {
                if (!event.participants.includes(player)) event.participants.push(player)
            })
        } else {
            console.warn(`Don't know how to populate an empty participants list for event ${JSON.stringify(event, null, 2)}`)
        }
    }
    return event
}

export function getEventById(id: string): Event|undefined {
    let _event = eventsData.find((event) => event.id === id && !event.ignore)
    if (!_event) {
        return undefined
    }
    try {
        const event = EventSchema.parse(_event);
        return populateMissingParticipants(event)
    } catch (err) {
        console.error(`getEventById(${JSON.stringify(id)}) failed to parse event data: ${JSON.stringify(_event, null, 2)}`, err)
        return undefined;
    }
}

export function getEventsAtCourse(courseId: string): Array<Event> {
    return eventsData.filter((event) => event.courses?.includes(courseId)).map(e => EventSchema.parse(e));
}

export function getCoursesOfEvent(eventId: string): Array<Course> {
    const event = getEventById(eventId);
    const courses: string[] = event?.format === 'matchplay' ? [] : event?.courses as string[]
    return (courses).flatMap((course_id) => {
        let _course = coursesData.find((course) => course.id === course_id);
        if (_course) return [CourseSchema.parse(_course)];
        else return [];
    });
}

export function parseEventDateRange(dateRange: string): { startDate: Date; endDate: Date } | null {
	const months = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"
	];

	// Regex to match patterns like "2024" (e.g. for a matchplay event with no specific dates – at least until the winner is known)
	const singleYearRegex = /^(\d{4})$/;
	// Regex to match patterns like "July 28, 2024"
	const singleDateRegex = /^(\w+)\s(\d+),\s(\d{4})$/;
	// Regex to match patterns like "September 25-28, 2024"
	const singleMonthRegex = /^(\w+)\s(\d+)\s*-\s*(\d+),\s(\d{4})$/;
	// Regex to match patterns like "September 30 - October 2, 2024"
	const twoMonthRegex = /^(\w+)\s(\d+)\s*-\s*(\w+)\s(\d+),\s(\d{4})$/;

	let match;

	if ((match = dateRange.match(singleMonthRegex))) {
		// "September 25-28, 2024"
		const [, month, startDay, endDay, year] = match;
		const monthIndex = months.indexOf(month);

		if (monthIndex === -1) return null;

		const startDate = new Date(parseInt(year), monthIndex, parseInt(startDay));
		const endDate = new Date(parseInt(year), monthIndex, parseInt(endDay));

		return { startDate, endDate };
	} else if ((match = dateRange.match(twoMonthRegex))) {
		// "September 30 - October 2, 2024"
		const [, startMonth, startDay, endMonth, endDay, year] = match;
		const startMonthIndex = months.indexOf(startMonth);
		const endMonthIndex = months.indexOf(endMonth);

		if (startMonthIndex === -1 || endMonthIndex === -1) return null;

		const startDate = new Date(parseInt(year), startMonthIndex, parseInt(startDay));
		const endDate = new Date(parseInt(year), endMonthIndex, parseInt(endDay));

		return { startDate, endDate };
	} else if ((match = dateRange.match(singleDateRegex))) {
		// "September 30, 2024"
		const [, month, day, year] = match;
		const monthIndex = months.indexOf(month);
		if (monthIndex === -1) return null;
		const startDate = new Date(parseInt(year), monthIndex, parseInt(day));
		return { startDate, endDate: startDate };
	} else if ((match = dateRange.match(singleYearRegex))) {
		// "2024"
		const [, year] = match;
		const startDate = new Date(parseInt(year), 0, 1, 12);
		const endDate = new Date(parseInt(year), 11, 31, 12);
		return { startDate, endDate };
	}

	// If the format does not match, return null
	return null;
}
