import eventsData from '../data/events.json';
import { type Event, schema as EventSchema } from '../schemas/events';

import coursesData from '../data/courses.json';
import { type Course, schema as CourseSchema } from '../schemas/courses';


export function getAllEventIds(): Array<string> {
    return eventsData.filter((record) => !record.ignore).map((record) => record.id);
}

export function getAllEvents(): Array<Event> {
    return eventsData
        .filter(record => !record.ignore)
        .map(record => getEventById(record.id))
        .filter(record => !!record) as Array<Event>;
}

export function getEventById(id: string): Event|undefined {
    let _event = eventsData.find((event) => event.id === id && !event.ignore)
    if (!_event) {
        return undefined
    }
    console.log(`getEventById(${JSON.stringify(id)}) => ${JSON.stringify(_event)}`)
    return EventSchema.parse(_event);
}

export function getEventsAtCourse(courseId: string): Array<Event> {
    return eventsData.filter((event) => event.courses.includes(courseId)).map(e => EventSchema.parse(e));
}

export function getCoursesOfEvent(eventId: string): Array<Course> {
    const event = getEventById(eventId);
    return (event?.courses || []).flatMap((course_id) => {
        let _course = coursesData.find((course) => course.id === course_id);
        if (_course) return [CourseSchema.parse(_course)];
        else return [];
    });
}
