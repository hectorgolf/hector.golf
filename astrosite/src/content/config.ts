import { defineCollection } from 'astro:content';
import { schema as coursesSchema } from '../schemas/courses.ts';
import { schema as eventsSchema } from '../schemas/events.ts';

export const collections = {
  'courses': defineCollection({ type: 'data', schema: coursesSchema }),
  'events': defineCollection({ type: 'data', schema: eventsSchema }),
};
