import { z } from 'astro:content';

export const schema = z.object({
    id: z.string(),
    name: z.string(),
    courses: z.array(z.string()),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
})

export type Event = z.infer<typeof schema>;

export default schema;
