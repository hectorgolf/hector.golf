import { z } from 'zod';

export const schema = z.object({
    player: z.string(),   // player id
    date: z.string(),     // ISO date (e.g. "2023-12-31")
    handicap: z.number(), // the player's handicap on the referenced date
})

export type HandicapHistoryEntry = z.infer<typeof schema>;

export default schema;
