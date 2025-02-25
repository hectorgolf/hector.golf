import { type Event, genericEventSchema as GenericEventSchema, type HectorEvent } from '../schemas/events';
import { type Course, schema as CourseSchema } from '../schemas/courses';
import { eventsData, coursesData } from './data';


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
    return eventsData.filter((event) => (event as HectorEvent)?.courses?.includes(courseId)).map(e => GenericEventSchema.parse(e));
}
