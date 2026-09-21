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
            /** Bucket object backing this image. In Firestore only; the export turns it into `url`. */
            object: z.string().optional(),
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
    /** Stable across renames. Assigned on import; absent from committed files. */
    id: z.string().optional(),
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
        // The scorecard is keyed by tee name, so two tees sharing one would make
        // a length ambiguous. See `course-tee-edits.test.ts`.
        .refine(
            (course) => new Set(course.tees.map((tee) => tee.name.toLowerCase())).size === course.tees.length,
            { message: "two tees on this course have the same name" },
        )
        .optional(),
    datasources: z.array(DatasourceSchema),
});

export type Course = z.infer<typeof schema>;
export type CourseTee = z.infer<typeof CourseTeeSchema>;

/** A tee's id from the name it was born with. See `course-tee-names.test.ts`. */
export function teeId(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** Where the export writes an uploaded image, relative to the site's `public/`. */
export function uploadedImagePath(courseId: string, objectName: string): string {
    return `/images/courses/${courseId}/uploaded/${objectName.split("/").pop()}`;
}

/**
 * The description as a committed file carries it: `url`, never `object`.
 *
 * The site reads `url` and has done since before any of this; keeping that the
 * only thing in the file is what lets none of the site change. `object` is the
 * store's business, the way a tee's `id` is.
 */
export function withPublishedImages(course: Course): Course {
    return {
        ...course,
        description_long: course.description_long.map((part) => {
            if (part.type !== "image" || !part.object) return part;
            const { object, ...rest } = part;
            return { ...rest, url: uploadedImagePath(course.id, object) };
        }),
    };
}

/** Every bucket object a course references, for the export to fetch and to keep. */
export function referencedObjects(course: Course): string[] {
    return course.description_long
        .filter((part) => part.type === "image" && part.object)
        .map((part) => (part as { object: string }).object);
}

/** The tees as the committed files carry them: no ids. */
export function withoutTeeIds(course: Course): Course {
    if (!course.course) return course;
    return {
        ...course,
        course: {
            ...course.course,
            tees: course.course.tees.map(({ id: _id, ...rest }) => rest),
        },
    };
}

/**
 * Tees replaced, and the scorecard's per-hole lengths rekeyed to match.
 *
 * Matched by `id`, which is the whole reason ids exist: a tee's name is what the
 * scorecard is keyed by *and* what a person edits, so a rename has to move both
 * at once and nothing else can say which old name became which new one.
 *
 * See `course-tee-edits.test.ts`.
 */
export function applyTeeEdits(stored: Course, tees: CourseTee[]): Course {
    if (!stored.course) return stored;

    const storedById = new Map((stored.course.tees ?? []).map((tee) => [tee.id ?? teeId(tee.name), tee]));
    const next = tees.map((tee) => ({ ...tee, id: tee.id ?? teeId(tee.name) }));
    const keptIds = new Set(next.map((tee) => tee.id));

    /*
     * Built from the stored names, not the submitted ones, so a swap — two tees
     * exchanging names — resolves correctly: every key is read from the original
     * object and written into a fresh one.
     */
    const rename = new Map<string, string>();
    for (const tee of next) {
        const before = storedById.get(tee.id!);
        if (before && before.name !== tee.name) rename.set(before.name, tee.name);
    }
    const dropped = new Set(
        [...storedById.values()].filter((tee) => !keptIds.has(tee.id ?? teeId(tee.name))).map((tee) => tee.name),
    );

    const rekey = (lengths: unknown): unknown => {
        if (!lengths || typeof lengths !== "object" || Array.isArray(lengths)) return lengths;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(lengths as Record<string, unknown>)) {
            if (dropped.has(key)) continue;
            out[rename.get(key) ?? key] = value;
        }
        return out;
    };

    const card = stored.course.scorecard;
    return {
        ...stored,
        course: {
            ...stored.course,
            tees: next,
            /*
             * Spread first, so every key the stored card carries survives with
             * the spelling it had. Sixteen of the seventeen courses record
             * `"ladies": null`, and rebuilding this object from its known
             * members dropped that key — a deletion nothing would have failed on.
             */
            scorecard: {
                ...card,
                men: (card?.men ?? []).map((hole) => ({ ...hole, lengths: rekey(hole.lengths) })),
                ...(Array.isArray(card?.ladies)
                    ? { ladies: card.ladies.map((hole) => ({ ...hole, lengths: rekey(hole.lengths) })) }
                    : {}),
            },
        },
    };
}

/** Every tee given an id, leaving one it already has alone. */
export function withTeeIds(course: Course): Course {
    if (!course.course) return course;
    return {
        ...course,
        course: {
            ...course.course,
            tees: course.course.tees.map(({ id, ...rest }) => ({ id: id ?? teeId(rest.name), ...rest })),
        },
    };
}

export default schema;
