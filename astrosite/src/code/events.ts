import { type Event, genericEventSchema as EventSchema, type MatchplayEvent, type MatchplayResults, type HectorEvent, type FinnkampenEvent, EventFormat, hectorEventSchema } from '../schemas/events';
import { type Course, schema as CourseSchema } from '../schemas/courses';
import { parseEventDateRange, isoDate, isoDateToday, compareDateStrings } from './dates';
import { eventsData, coursesData, isPastEvent } from './data';
import { getPlayerHandicapById } from './players';


export const linkToEvent = (event: Event|string): string => {
    if (typeof(event) === 'string') {
        const eventObject = getEventById(event)
        if (eventObject) {
            return linkToEvent(eventObject)
        }
        throw new Error(`Event with id ${event} not found`)
    }
    return `/events/${event.format}/${event.id}`
};

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

export function eventHasStarted(event: Event): boolean {
    const range = parseEventDateRange(event.date) || { startDate: undefined, endDate: undefined };
    const {startDate} = range
    // console.log(`Checking if event ${event.name} has started: ${JSON.stringify(range)} vs ${isoDateToday()}`)
    return !!(startDate && isoDate(startDate) <= isoDateToday())
}

export function eventHasEnded(event: Event): boolean {
    const range = parseEventDateRange(event.date) || { startDate: undefined, endDate: undefined };
    const {endDate} = range
    // console.log(`Checking if event ${event.name} has ended: ${JSON.stringify(range)} vs ${isoDateToday()}`)
    return !!(endDate && isoDate(endDate) < isoDateToday())
}

export function getAllEventsGroupedByChronology(providedFilter?: (e: Event) => boolean): { ongoing: Array<Event>, upcoming: Array<Event>, past: Array<Event> } {
    const isFinishedMatchplayEvent = (event: Event): boolean => {
        return !!(event.format === EventFormat.Matchplay && (event as MatchplayEvent).results?.winners?.matchplay)
    }

    const pastEvents: Array<Event> = []
    const ongoingEvents: Array<Event> = []
    const upcomingEvents: Array<Event> = []
    getAllEvents(providedFilter).forEach(event => {
        const range = parseEventDateRange(event.date) || { startDate: undefined, endDate: undefined };
        const {startDate, endDate} = range
        const today = isoDateToday()
        const isFuture = startDate && isoDate(startDate) > today
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
    const sortByDate = (a: Event, b: Event): number => {
        const c = compareDateStrings(a.date, b.date);
        if (c !== 0) {
            return -c;
        }
        return a.name.localeCompare(b.name)
    }
    return { ongoing: ongoingEvents.sort(sortByDate), upcoming: upcomingEvents.sort(sortByDate), past: pastEvents.sort(sortByDate) }
}

const populateMissingParticipants = (event: Event): Event => {
    // If the event has an empty list of participants, try to populate it from
    // the event's results object (teams of a team event or the matches of
    // a matchplay event)
    if (event.participants.length === 0 && event.results) {
        if (event.format === EventFormat.Matchplay) {
            const results: MatchplayResults = (event as MatchplayEvent).results as MatchplayResults
            results.bracket.flatMap(round => round.matches).forEach(match => {
                if (match.left && !event.participants.includes(match.left)) event.participants.push(match.left)
                if (match.right && !event.participants.includes(match.right)) event.participants.push(match.right)
            })
        } else if (event.format === EventFormat.Hector) {
            const results = (event as HectorEvent).results
            const teams = results?.teams || []
            teams.flatMap(team => team.players).forEach(player => {
                if (!event.participants.includes(player)) event.participants.push(player)
            })
        } else if (event.format === EventFormat.Finnkampen) {
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

function isHectorEvent(event: Event): event is HectorEvent {
    return event.format === EventFormat.Hector
}

const populateUpdatedHandicaps = (event: Event): Event => {
    if (isHectorEvent(event) && !isPastEvent(event)) {
        function updateHcp(id: string, handicap: number|undefined) {
            return { id, handicap: getPlayerHandicapById(id) }
        }
        event.buckets = event.buckets?.map(bucket => bucket.map(p => updateHcp(p.id, p.handicap)))
    }
    return event
}

export function getEventById(id: string): Event|undefined {
    let _event = eventsData.find((event) => event.id === id && !event.ignore)
    if (!_event) {
        return undefined
    }
    try {
        let event = EventSchema.parse(_event);
        event = populateMissingParticipants(event)
        event = populateUpdatedHandicaps(event)
        return event
    } catch (err) {
        console.error(`getEventById(${JSON.stringify(id)}) failed to parse event data: ${JSON.stringify(_event, null, 2)}`, err)
        return undefined;
    }
}

export function getEventsAtCourse(courseId: string): Array<Event> {
    return eventsData.filter((event) => (event as HectorEvent)?.courses?.includes(courseId)).map(e => EventSchema.parse(e));
}

export function getCoursesOfEvent(eventId: string): Array<Course> {
    const event = getEventById(eventId);
    const courses: string[] = event?.format === EventFormat.Matchplay ? [] : event?.courses as string[]
    return (courses).flatMap((course_id) => {
        let _course = coursesData.find((course) => course.id === course_id);
        if (_course) return [CourseSchema.parse(_course)];
        else return [];
    });
}
