import eventsData from '../data/events.json';
import { type Event, genericEventSchema as EventSchema } from '../schemas/events';

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

export function getEventById(id: string): Event|undefined {
    let _event = eventsData.find((event) => event.id === id && !event.ignore)
    if (!_event) {
        return undefined
    }
    // console.log(`getEventById(${JSON.stringify(id)}) => ${JSON.stringify(_event, null, 2)}`)
    try {
        return EventSchema.parse(_event);
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
