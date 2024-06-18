import { z } from 'astro:content';

export const schema = z.object({
    id: z.string(),
    name: z.object({
        first: z.string(),
        last: z.string()
    }),
    contact: z.object({
        phone: z.string()
    }),
    image: z.string().optional()
})

export type Player = z.infer<typeof schema>;

export default schema;
