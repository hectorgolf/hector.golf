import { z } from 'astro:content';

const matchplayMatchSchema = z.object({
    id: z.string(),
    leftSource: z.string().nullable(),
    rightSource: z.string().nullable(),
    left: z.string().nullable(),
    right: z.string().nullable(),
    score: z.string().nullable(),
    winner: z.string().nullable()
})

const matchplayResultsSchema = z.object({
    winners: z.object({
        matchplay: z.string().optional()
    }),
    bracket: z.array(z.object({
        round: z.number(),
        matches: z.array(matchplayMatchSchema)
    }))
});

const hectorResultsSchema = z.object({
    teams: z.array(z.object({
        name: z.string(),
        players: z.array(z.string())
    })),
    winners: z.object({
        hector: z.array(z.string()).optional(),
        victor: z.array(z.string()).optional()
    })
}).optional()

const finnkampenResultsSchema = z.object({
    teams: z.array(z.object({
        name: z.string(),
        players: z.array(z.string())
    })),
    winners: z.object({
        finnkampen: z.array(z.string()).optional()
    })
}).optional()


const BaseEventSchema = z.object({
    id: z.string(),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    participants: z.array(z.string()),
})

export const hectorEventSchema = BaseEventSchema.extend({
    format: z.literal('hector'),
    courses: z.array(z.string()).optional(),
    results: hectorResultsSchema.optional()
})

export const finnkampenEventSchema = BaseEventSchema.extend({
    format: z.literal('finnkampen'),
    courses: z.array(z.string()).optional(),
    results: finnkampenResultsSchema.optional()
})

export const matchplayEventSchema = BaseEventSchema.extend({
    format: z.literal('matchplay'),
    results: matchplayResultsSchema.optional()
})

export const genericEventSchema = z.discriminatedUnion("format", [ hectorEventSchema, matchplayEventSchema, finnkampenEventSchema ])


export type Event = z.infer<typeof genericEventSchema>;

export type MatchplayMatch = z.infer<typeof matchplayMatchSchema>;
export type MatchplayResults = z.infer<typeof matchplayResultsSchema>;
export type MatchplayEvent = z.infer<typeof matchplayEventSchema>;
export type HectorEvent = z.infer<typeof hectorEventSchema>;
export type HectorResults = z.infer<typeof hectorResultsSchema>;
export type FinnkampenEvent = z.infer<typeof finnkampenEventSchema>;
export type FinnkampenResults = z.infer<typeof finnkampenResultsSchema>;
