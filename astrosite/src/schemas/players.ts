import { z } from 'astro:content';

let x = {
    id: "daniel-hylton",
    name: { first: "Daniel", last: "Hylton" },
    contact: {
        phone: "+358403424395"
    }
}

export const schema = z.object({
    id: z.string(),
    name: z.object({
        first: z.string(),
        last: z.string()
    }),
    contact: z.object({
        phone: z.string()
    })
})

export type Player = z.infer<typeof schema>;

export default schema;
