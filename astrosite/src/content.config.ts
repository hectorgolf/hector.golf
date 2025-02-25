import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { schema as coursesSchema } from './schemas/courses.ts';
import { schema as playersSchema } from './schemas/players.ts';
import { genericEventSchema } from './schemas/events.ts';

export const collections = {
  'courses': defineCollection({ schema: coursesSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/courses" }) }),
  'players': defineCollection({ schema: playersSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/players" }) }),
  'events': defineCollection({ schema: genericEventSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/events" }) }),
};
