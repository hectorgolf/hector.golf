import { z } from "zod";

const matchplayMatchSchema = z.object({
    id: z.string(),
    leftSource: z.string().nullable(),
    rightSource: z.string().nullable(),
    left: z.string().nullable(),
    right: z.string().nullable(),
    score: z.string().nullable(),
    winner: z.string().nullable(),
});

const matchplayResultsSchema = z.object({
    winners: z.object({
        matchplay: z.string().optional(),
    }),
    bracket: z.array(
        z.object({
            round: z.number(),
            matches: z.array(matchplayMatchSchema),
        }),
    ),
});

const hectorResultsSchema = z
    .object({
        teams: z
            .array(
                z.object({
                    name: z.string(),
                    players: z.array(z.string()),
                }),
            )
            .optional(),
        winners: z
            .object({
                hector: z.array(z.string()).optional(),
                victor: z.array(z.string()).optional(),
            })
            .optional(),
    })
    .optional();

const openingShotsRequirementSchema = z
    .object({
        minimumPerPlayer: z.number().min(0).max(9).optional(),
        penaltyPerMissingStroke: z.number().min(0).max(5).optional(),
    })
    .refine((data) => (data.minimumPerPlayer ?? 0) > 0 || !(data.penaltyPerMissingStroke ?? 0), {
        message: "penaltyPerMissingStroke requires a minimumPerPlayer greater than 0",
    });

const gameFormatNameSchema = z.enum([
    "Stableford NET",
    "Stableford SCR",
    "Stroke Play NET",
    "Stroke Play SCR",
    "Better Ball Stroke Play NET",
    "Better Ball Stroke Play SCR",
    "Better Ball Stableford NET",
    "Better Ball Stableford SCR",
    "Scramble Stroke Play NET",
    "Scramble Stableford NET",
]);

const gameFormatSchema = z
    .object({
        format: gameFormatNameSchema,
        competition: z.array(z.enum(["hector", "victor"])).optional(),
        handicapAllowance: z.number().optional(),
        contribution: z
            .object({
                hector: z.number().optional(),
                victor: z.number().optional(),
            })
            .optional(),
        teamContribution: z.enum(["both", "better", "team"]).optional(),
        birdieBonus: z.number().optional(),
        eagleBonus: z.number().optional(),
        openingShotsRequirement: openingShotsRequirementSchema.optional(),
    })
    .refine((data) => !data.openingShotsRequirement || data.format.toLowerCase().includes("scramble"), {
        message: "openingShotsRequirement is only valid for Scramble game formats",
        path: ["openingShotsRequirement"],
    });

/**
 * Highest score that counts on a single hole, as strokes over par.
 *
 * Hector events play a maximum score per hole: with the default of 4, a 10 on a par
 * 4 counts as an 8. The cap is applied when a card is read, so a player who marked
 * their actual 10 is scored as though they had marked the 8.
 *
 * In practice this is 4 or 5. Going lower gets dangerous rather than merely
 * generous: a cap of 3 would let a high-handicapper mark par+3 on every hole and
 * still collect 36 Stableford points, so the range is deliberately wide enough to
 * allow it and the default deliberately is not.
 */
const maxStrokesOverParValue = z
    .number()
    .int() // whole numbers only
    .min(1) // must be a non-zero value
    .max(9); // keep the max value single-digit to have it look nice in the UI

/** The event-wide rule, and what every round plays unless it says otherwise. */
const eventMaxStrokesOverParSchema = maxStrokesOverParValue
    .optional() // the field is optional
    .default(4); // default to par+4 if omitted

/**
 * A single round's departure from the event's rule.
 *
 * Left absent on almost every round, and absent means "whatever the event plays"
 * rather than any number of its own — which is why this one carries no default.
 * The exceptions are real but rare: a Scramble hardly needs a cap, and a par-3
 * course wants a different one.
 *
 * It belongs to the round rather than to a game format because the cap is about how
 * a hole is played. A round's formats share the same holes and the same physical
 * card, so letting two of them disagree about what a 10 counts as would be
 * incoherent.
 */
const roundMaxStrokesOverParSchema = maxStrokesOverParValue.optional();

const hectorRoundSchema = z.object({
    day: z.number(),
    round: z.number(),
    course: z.string(),
    tee: z.string(),
    maxStrokesOverPar: roundMaxStrokesOverParSchema,
    gameFormats: z.array(gameFormatSchema),
});

const finnkampenResultsSchema = z
    .object({
        teams: z.array(
            z.object({
                name: z.string(),
                players: z.array(z.string()),
            }),
        ),
        winners: z.object({
            finnkampen: z.array(z.string()).optional(),
        }),
    })
    .optional();

const BaseEventSchema = z.object({
    id: z.string(),
    ignore: z.boolean().optional().default(false),
    name: z.string(),
    location: z.string(),
    date: z.string(),
    hero_image: z.string().optional(),
    description: z.string().optional(),
    participants: z.array(z.string()),
});

export enum EventFormat {
    Hector = "hector",
    Matchplay = "matchplay",
    Finnkampen = "finnkampen",
}

export const hectorEventSchema = BaseEventSchema.extend({
    format: z.literal(EventFormat.Hector),
    maxStrokesOverPar: eventMaxStrokesOverParSchema,
    courses: z.array(z.string()).optional(),
    rounds: z.array(hectorRoundSchema).optional(),
    buckets: z
        .array(
            z.array(
                z.object({
                    id: z.string(),
                    handicap: z.number().optional(),
                }),
            ),
        )
        .optional(),
    results: hectorResultsSchema.optional(),
    leaderboardSheet: z.string().optional(),
});

export const finnkampenEventSchema = BaseEventSchema.extend({
    format: z.literal(EventFormat.Finnkampen),
    courses: z.array(z.string()).optional(),
    results: finnkampenResultsSchema.optional(),
});

export const matchplayEventSchema = BaseEventSchema.extend({
    format: z.literal(EventFormat.Matchplay),
    results: matchplayResultsSchema.optional(),
});

export const genericEventSchema = z.discriminatedUnion("format", [
    hectorEventSchema,
    matchplayEventSchema,
    finnkampenEventSchema,
]);

export type Event = z.infer<typeof genericEventSchema>;

/** The name of a game format, e.g. "Better Ball Stableford NET". */
export type HectorGameFormatName = z.infer<typeof gameFormatSchema>["format"];

export type MatchplayMatch = z.infer<typeof matchplayMatchSchema>;
export type MatchplayResults = z.infer<typeof matchplayResultsSchema>;
export type MatchplayEvent = z.infer<typeof matchplayEventSchema>;
export type HectorEvent = z.infer<typeof hectorEventSchema>;
export type HectorResults = z.infer<typeof hectorResultsSchema>;
export type FinnkampenEvent = z.infer<typeof finnkampenEventSchema>;
export type FinnkampenResults = z.infer<typeof finnkampenResultsSchema>;
