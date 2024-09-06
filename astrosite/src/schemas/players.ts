import { z } from 'astro:content';

export const schema = z.object({
    id: z.string(),
    name: z.object({
        first: z.string(),
        last: z.string()
    }),
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
})

export type Player = z.infer<typeof schema>;

export default schema;
