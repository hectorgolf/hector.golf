import eventsData from '../data/events.json';
import { type Event, schema as EventSchema } from '../schemas/events';

import coursesData from '../data/courses.json';
import { type Course, schema as CourseSchema } from '../schemas/courses';


export function getAllEventIds(): Array<string> {
    return eventsData.map((record) => record.id);
}

export function getEventById(id: string): Event|undefined {
    let _event = eventsData.find((event) => event.id === id)
    if (!_event) {
        return undefined
    }
    return EventSchema.parse(_event);
}

export function getEventsAtCourse(courseId: string): Array<Event> {
    return eventsData.filter((event) => event.courses.includes(courseId)).map(e => EventSchema.parse(e));
}

export function getCoursesOfEvent(eventId: string): Array<Course> {
    const event = getEventById(eventId);
    console.log(`getCoursesOfEvent(${JSON.stringify(eventId)}) :: getEventById(${JSON.stringify(eventId)}) => ${JSON.stringify(event)}`)
    return (event?.courses || []).flatMap((course_id) => {
        let _course = coursesData.find((course) => course.id === course_id);
        if (_course) return [CourseSchema.parse(_course)];
        else return [];
    });
}
