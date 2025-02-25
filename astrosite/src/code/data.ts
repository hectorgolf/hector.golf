import { readFileSync } from 'fs';
import { glob } from 'glob';

import { type Event, genericEventSchema as EventSchema } from '../schemas/events';

import { type Course, schema as CourseSchema } from '../schemas/courses';
import { type Player, schema as PlayerSchema } from '../schemas/players';

/**
 * Filter function for dropping undefined values.
 *
 * @param x Candidate value.
 * @returns true if the value is defined (and presumably of the right type), false if it is `undefined`.
 */
const nonUndefined = <T>(x: T | undefined): x is T => x !== undefined;

/**
 * All `Event` objects found from `src/data/events/`.
 */
export const eventsData: Event[] = (await glob('src/data/events/**/*.json')).map(filePath => {
    return EventSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8'))).data
}).filter(nonUndefined);

/**
 * All `Course` objects found from `src/data/courses/`.
 */
export const coursesData: Course[] = (await glob('src/data/courses/**/*.json')).map(filePath => {
    return CourseSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8'))).data
}).filter(nonUndefined);

/**
 * All `Player` objects found from `src/data/players/`.
 */
export const playersData: Player[] = (await glob('src/data/players/**/*.json')).map(filePath => {
    return PlayerSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8'))).data
}).filter(nonUndefined);
