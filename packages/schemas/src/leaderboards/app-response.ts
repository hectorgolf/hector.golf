import z from "zod";

/**
 * What app.hector.golf answers `/api/tournament` with, validated in full.
 *
 * The strict counterpart to the structural reader in `app-payload.ts`, and the
 * difference is what happens to a payload that has drifted. The browser's live
 * board reads only the fields it renders, because the cost of being wrong there
 * is a table that does not refresh. This is the schema for the two callers that
 * can *publish* what they read — the site's update workflow and the admin's
 * leaderboards job — where a half-understood payload becomes a committed file.
 *
 * Fields nothing here reads are still declared, and deliberately: a response
 * that stopped carrying `rounds` or `players` is one this repository has
 * misunderstood, and failing the parse is how that is noticed while the standings
 * on the site are still the last ones that made sense.
 */
export const appTournamentResponseSchema = z.object({
    generatedAt: z.coerce.date(),
    event: z.object({
        id: z.string(),
        name: z.string(),
        venue: z.string(),
        dates: z.string(),
    }),
    status: z.enum(["upcoming", "live", "final"]),
    levelPar: z.number(),
    players: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            hi: z.number(),
            bucket: z.union([z.literal(1), z.literal(2)]),
        }),
    ),
    pairs: z.array(
        z.object({
            id: z.string(),
            defending: z.boolean(),
            players: z.array(z.string()),
        }),
    ),
    rounds: z.array(
        z.object({
            seq: z.number(),
            day: z.string(),
            date: z.coerce.date(),
            course: z.string(),
            status: z.enum(["final", "open", "upcoming"]),
            formats: z.array(z.string()),
        }),
    ),
    hector: z.array(
        z.object({
            // null (or absent) until the event is under way and there is something to rank.
            position: z.number().nullable().optional(),
            positionLabel: z.string().optional(),
            pairId: z.string().optional(),
            players: z.string(),
            points: z.number().default(0),
            diffToLeader: z.number().optional().nullable(),
            thru: z.number().optional().nullable(),
            roundsPlayed: z.number().default(0),
            perRound: z.record(z.string(), z.number()).optional(),
        }),
    ),
    victor: z.array(
        z.object({
            // null (or absent) until the event is under way and there is something to rank.
            position: z.number().nullable().optional(),
            positionLabel: z.string().optional(),
            playerId: z.string().optional(),
            player: z.string(),
            points: z.number().default(0),
            diffToLeader: z.number().optional().nullable(),
            roundsPlayed: z.number().default(0),
        }),
    ),
});

export type AppTournamentResponse = z.infer<typeof appTournamentResponseSchema>;
