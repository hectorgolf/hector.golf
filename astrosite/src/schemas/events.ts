import { z } from 'astro:content';

export const schema = z.object({
    id: z.string(),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    courses: z.array(z.string()),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    results: z.object({
        teams: z.array(z.object({
            name: z.string(),
            players: z.array(z.string())
        })),
        winners: z.object({
            hector: z.array(z.string()).optional(),
            victor: z.array(z.string()).optional(),
        })
    }).optional()
})

export type Event = z.infer<typeof schema>;

export default schema;
