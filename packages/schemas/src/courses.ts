import { z } from "zod";

const AbsoluteOrRelativeImageURL = z.url().or(z.string().startsWith("/images"));

const ContactSchema = z.object({
    address: z.string(),
    phone: z.string().optional(),
    email: z.email().optional(),
});

const MultimediaDescriptionSchema = z.array(
    z.union([
        z.object({
            type: z.literal("paragraph"),
            content: z.string().optional(),
        }),
        z.object({
            type: z.literal("image"),
            url: AbsoluteOrRelativeImageURL.optional(),
        }),
    ]),
);

const DatasourceSchema = z.object({
    name: z.string(),
    url: z.url(),
});

const HoleNumberSchema = z.number().min(1).max(18);
const SlopeIndexSchema = z.number().min(1).max(18);
const HoleParSchema = z.number().min(1).max(7);

const ScorecardHoleSchema = z.object({
    hole: HoleNumberSchema,
    par: HoleParSchema,
    hcp: SlopeIndexSchema,
    lengths: z.any(),
});

const HoleDescriptionSchema = z.object({
    hole: HoleNumberSchema,
    shape: z.enum(["narrow", "wide"]).optional(),
    layout: z.string(),
    description: z.string(),
});

const CourseTeeSchema = z.object({
    name: z.string(),
    name_local: z.string().optional(),
    color: z.string(),
    stroke: z.string().optional(),
    length: z.number().min(1).max(9999),
    par: z.number().min(1).max(99),
    par_ladies: z.number().min(1).max(99).optional(),
    rating: z.object({
        men: z.number().min(1).max(199).or(z.null()),
        ladies: z.number().min(1).max(199).or(z.null()),
    }),
    slope: z.object({
        men: z.number().min(1).max(199).or(z.null()),
        ladies: z.number().min(1).max(199).or(z.null()),
    }),
});

export const schema = z.object({
    id: z.string(),
    name: z.string(),
    homepage: z.url(),
    contact: ContactSchema,
    hero_image: AbsoluteOrRelativeImageURL.optional(),
    description_short: z.string(),
    description_long: MultimediaDescriptionSchema,
    images: z.object({
        hero: AbsoluteOrRelativeImageURL.optional(),
        /**
         * An aerial shot of the course, where one exists. Penáti's two courses
         * have them and nothing else does.
         *
         * Here for the same reason as `hero`, which it sits beside in those two
         * files and which was added a commit earlier: the field was in the data
         * and not in the schema, so it was being dropped on every read. Nothing
         * renders it yet.
         */
        aerial: AbsoluteOrRelativeImageURL.optional(),
        course_layout: AbsoluteOrRelativeImageURL.optional(),
    }),
    course: z
        .object({
            tees: z.array(CourseTeeSchema),
            scorecard: z.object({
                men: z.array(ScorecardHoleSchema),
                ladies: z.array(ScorecardHoleSchema).optional().or(z.null()),
            }),
            descriptions: z.array(HoleDescriptionSchema).optional().or(z.null()),
            descriptions_local: z.array(HoleDescriptionSchema).optional().or(z.null()),
        })
        .optional(),
    datasources: z.array(DatasourceSchema),
});

export type Course = z.infer<typeof schema>;

export default schema;
