import { z } from 'astro:content';


const matchplayResults = z.object({
    participants: z.array(z.string()),
    winners: z.object({
        matchplay: z.string().optional()
    }),
    bracket: z.array(z.object({
        round: z.number(),
        matches: z.array(z.object(
            {
                id: z.string(),
                leftSource: z.string().nullable(),
                rightSource: z.string().nullable(),
                left: z.string().nullable(),
                right: z.string().nullable(),
                score: z.string().nullable(),
                winner: z.string().nullable()
            }
        ))
    }))
});

const hectorResults = z.object({
    teams: z.array(z.object({
        name: z.string(),
        players: z.array(z.string())
    })),
    winners: z.object({
        hector: z.array(z.string()).optional(),
        victor: z.array(z.string()).optional()
    })
}).optional()

const finnkampenResults = z.object({
    teams: z.array(z.object({
        name: z.string(),
        players: z.array(z.string())
    })),
    winners: z.object({
        finnkampen: z.array(z.string()).optional()
    })
}).optional()


export const hectorEventSchema = z.object({
    id: z.string(),
    format: z.literal('hector'),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    courses: z.array(z.string()).optional(),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    participants: z.array(z.string()).optional(),
    results: hectorResults.optional()
})

export const finnkampenEventSchema = z.object({
    id: z.string(),
    format: z.literal('finnkampen'),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    courses: z.array(z.string()).optional(),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    results: finnkampenResults.optional()
})

export const matchplayEventSchema = z.object({
    id: z.string(),
    format: z.literal('matchplay'),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    results: matchplayResults.optional()
})

export const genericEventSchema = z.discriminatedUnion("format", [ hectorEventSchema, matchplayEventSchema, finnkampenEventSchema ])


export type Event = z.infer<typeof genericEventSchema>;

export type MatchplayEvent = z.infer<typeof matchplayEventSchema>;
export type HectorEvent = z.infer<typeof hectorEventSchema>;
export type FinnkampenEvent = z.infer<typeof finnkampenEventSchema>;

export default genericEventSchema;
