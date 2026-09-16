import { defineCollection } from 'astro:content';

import { schema as coursesSchema } from '@hector/schemas/src/courses.ts';
import { schema as playersSchema } from '@hector/schemas/src/players.ts';
import { genericEventSchema } from '@hector/schemas/src/events.ts';

import { snapshotCollection } from './code/snapshot-loader.ts';

/**
 * These used to be Astro's `glob()` loader pointed at `./src/data/{courses,players,events}`.
 * The directories are gone — see `docs/plans/everything-to-firestore.md` — so the
 * collections are loaded from the same snapshot `data.ts` reads, and the schemas
 * are unchanged.
 */
export const collections = {
  'courses': defineCollection({ schema: coursesSchema, loader: snapshotCollection('courses') }),
  'players': defineCollection({ schema: playersSchema, loader: snapshotCollection('players') }),
  'events': defineCollection({ schema: genericEventSchema, loader: snapshotCollection('events') }),
};
