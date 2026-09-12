import { type Event, genericEventSchema as GenericEventSchema, type HectorEvent } from '@hector/schemas/src/events.ts';
import { type Course, schema as CourseSchema } from '@hector/schemas/src/courses.ts';
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
