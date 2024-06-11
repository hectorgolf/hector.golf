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


let x: Player = {
    id: "daniel-hylton",
    name: { first: "Daniel", last: "Hylton" },
    contact: {
        phone: "+358403424395"
    }
}
