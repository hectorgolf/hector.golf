import eventsData from '../data/events.json';
import { type Event, genericEventSchema as GenericEventSchema } from '../schemas/events';

import coursesData from '../data/courses.json';
import { type Course, schema as CourseSchema } from '../schemas/courses';


export function getAllCourseIds(): Array<string> {
    return coursesData.map((record) => record.id);
}

export function getCourseById(id: string): Course|undefined {
    let record = coursesData.find((record) => record.id === id)
    if (!record) {
        return undefined
    }
    return CourseSchema.parse(record);
}

export function getEventsAtCourse(courseId: string): Array<Event> {
    return eventsData.filter((event) => event.courses?.includes(courseId)).map(e => GenericEventSchema.parse(e));
}
