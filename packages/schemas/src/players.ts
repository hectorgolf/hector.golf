import { z } from 'zod';

export const schema = z.object({
    id: z.string(),
    gender: z.enum(['male', 'female']).optional(),
    name: z.object({
        first: z.string(),
        last: z.string()
    }),
    privacy: z.enum(['shorten-last-name']).optional(),
    aliases: z.array(z.object({
        first: z.string(),
        last: z.string()
    })).optional(),
    contact: z.object({
        phone: z.string()
    }),
    image: z.string().optional(),
    club: z.string().optional(),
    handicap: z.number().optional(),
    misc: z.array(z.string()).optional(),
    biography: z.array(z.string()).optional(),
    biographyLocked: z.boolean().optional(),
    /** When the model wrote the current biography. Absent means unknown, which counts as stale. */
    biographyGeneratedAt: z.string().optional(),
})

export type Player = z.infer<typeof schema>;

export default schema;
