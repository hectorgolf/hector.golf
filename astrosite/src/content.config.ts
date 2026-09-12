import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { schema as coursesSchema } from '@hector/schemas/src/courses.ts';
import { schema as playersSchema } from '@hector/schemas/src/players.ts';
import { genericEventSchema } from '@hector/schemas/src/events.ts';

export const collections = {
  'courses': defineCollection({ schema: coursesSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/courses" }) }),
  'players': defineCollection({ schema: playersSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/players" }) }),
  'events': defineCollection({ schema: genericEventSchema, loader: glob({ pattern: '**/[^_]*.json', base: "./src/data/events" }) }),
};
