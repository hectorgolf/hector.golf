import { defineCollection } from 'astro:content';
import { schema as coursesSchema } from '../schemas/courses.ts';
import { genericEventSchema, finnkampenEventSchema, hectorEventSchema, matchplayEventSchema } from '../schemas/events.ts';

export const collections = {
  'courses': defineCollection({ type: 'data', schema: coursesSchema }),
  'events': defineCollection({ type: 'data', schema: genericEventSchema }),
  'hectorEvents': defineCollection({ type: 'data', schema: hectorEventSchema }),
  'matchplayEvents': defineCollection({ type: 'data', schema: matchplayEventSchema }),
  'finnkampenEvents': defineCollection({ type: 'data', schema: finnkampenEventSchema }),
};
