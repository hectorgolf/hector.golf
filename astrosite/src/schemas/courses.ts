import { z } from 'astro:content';

export const schema = z.object({
    id: z.string(),
    name: z.string(),
    homepage: z.string().url(),
    contact: z.object({
        address: z.string(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
    }),
    hero_image: z.string().url(),
    description_short: z.string(),
    description_long: z.array(z.union([
        z.object({
            type: z.literal('paragraph'),
            content: z.string().optional()
        }),
        z.object({
            type: z.literal('image'),
            url: z.string().url().optional(),
        })
    ])),
    images: z.object({
        course_layout: z.string().url().or(z.string().startsWith('/')).optional(),
    }),
    course: z.object({
        tees: z.array(z.object({
            name: z.string(),
            color: z.string(),
            length: z.number().min(1).max(9999),
            par: z.number().min(1).max(99),
            rating: z.object({
                men: z.number().min(1).max(199).or(z.null()),
                ladies: z.number().min(1).max(199).or(z.null())
            }),
            slope: z.object({
                men: z.number().min(1).max(199).or(z.null()),
                ladies: z.number().min(1).max(199).or(z.null())
            })
        })),
        scorecard: z.object({
            men: z.array(z.object({
                hole: z.number().min(1).max(18),
                par: z.number().min(1).max(7),
                hcp: z.number().min(1).max(18),
                lengths: z.any()
            })),
            ladies: z.array(z.object({
                hole: z.number().min(1).max(18),
                par: z.number().min(1).max(7),
                hcp: z.number().min(1).max(18),
                lengths: z.any()
            })).or(z.null())
        }),
        descriptions: z.array(z.object({
            hole: z.number().min(1).max(18),
            layout: z.string(),
            description: z.string()
        }))
    }),
    datasources: z.array(z.object({
        name: z.string(),
        url: z.string().url()
    }))
})

export type Course = z.infer<typeof schema>;

export default schema;
