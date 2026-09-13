import { z } from 'zod';

import { isValidIsoInstant } from './dates.ts';

export const schema = z.object({
    player: z.string(),   // player id
    date: z.string(),     // ISO date (e.g. "2023-12-31")
    handicap: z.number(), // the player's handicap on the referenced date

    /**
     * When this value was read from the handicap source, e.g. "2026-09-13T03:02:42Z".
     *
     * Not the same question as `date`, and the gap between the two is the point.
     * `date` is the day the handicap belongs to; `observed` is the moment we saw it.
     * The Finnish Golf Union runs its nightly WHS batch at about 03:00 Finnish time
     * and re-runs it during office hours when the nightly run failed, so a handicap
     * dated today may not have reached WiseGolf until this afternoon — and a value
     * read this morning may have been partial, wrong, or simply the previous day's.
     * Nothing in the value itself says which. `docs/handicap-updates.md` has the
     * whole picture.
     *
     * What it is for: explaining, afterwards, why a page showed what it showed. A
     * Hector's buckets freeze at 08:00 on the first morning, and "the buckets look
     * wrong" and "the handicap arrived at 16:12" are the same fact seen from two
     * ends. Without this field that reconstruction means reading commit timestamps.
     *
     * Optional because the 1393 entries written before this field existed genuinely
     * have no recorded observation time, and inventing one would be worse than
     * leaving it out. Every entry written from now on carries it.
     */
    observed: z
        .string()
        .refine(isValidIsoInstant, {
            message: 'expected a UTC instant to the second, e.g. 2026-09-13T03:02:42Z',
        })
        .optional(),
})

export type HandicapHistoryEntry = z.infer<typeof schema>;

export default schema;
