import { n as firestore } from "./firestore_CD0Y0VvD.mjs";
import { z } from "zod";
//#region ../packages/schemas/src/dates.ts
var ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
var MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December"
];
/**
* True if the string is a real calendar date in ISO format.
*
* The pattern alone is not enough: "2026-02-30" matches it and does not exist, and
* `Date` would quietly roll it over into March.
*/
function isValidIsoDate(date) {
	const match = date.match(ISO_DATE_PATTERN);
	if (!match) return false;
	const [, year, month, day] = match;
	const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
	return parsed.getFullYear() === Number(year) && parsed.getMonth() === Number(month) - 1 && parsed.getDate() === Number(day);
}
/**
* Reads an ISO date into a `Date` at local noon.
*
* Noon rather than midnight because nothing here cares about the time of day, and
* midnight sits close enough to the boundary that a timezone offset or a daylight
* saving transition can push it onto the day before or after.
*
* @param date A calendar date in ISO format (yyyy-mm-dd).
* @returns The `Date` at noon local time on that day.
* @throws If the string is not a real ISO calendar date.
*/
function parseIsoDate(date) {
	if (!isValidIsoDate(date)) throw new Error(`Not a calendar date in ISO format (yyyy-mm-dd): ${JSON.stringify(date)}`);
	const [, year, month, day] = date.match(ISO_DATE_PATTERN);
	return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
}
/**
* A date range as it reads on a page: "September 24–27, 2026".
*
* Collapses whatever the two dates have in common — a one-day event names its day
* once, a range within a month names the month once, and a range within a year
* names the year once.
*
* @param startDate The first day, in ISO format (yyyy-mm-dd).
* @param endDate The last day, in ISO format (yyyy-mm-dd).
* @returns The range rendered for display.
*/
function formatDateRange(startDate, endDate) {
	const start = parseIsoDate(startDate);
	const end = parseIsoDate(endDate);
	const startMonth = MONTH_NAMES[start.getMonth()];
	const endMonth = MONTH_NAMES[end.getMonth()];
	if (startDate === endDate) return `${startMonth} ${start.getDate()}, ${start.getFullYear()}`;
	if (start.getFullYear() !== end.getFullYear()) return `${startMonth} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
	if (start.getMonth() !== end.getMonth()) return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
	return `${startMonth} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
}
/**
* An event's dates as they read on a page: "September 24–27, 2026".
*
* @param event Anything carrying an event's timing, which in practice is an `Event`.
* @returns The event's date range rendered for display.
*/
function formatEventDates(event) {
	return formatDateRange(event.timing.start, event.timing.end);
}
//#endregion
//#region ../packages/schemas/src/events.ts
var matchplayMatchSchema = z.object({
	id: z.string(),
	leftSource: z.string().nullable(),
	rightSource: z.string().nullable(),
	left: z.string().nullable(),
	right: z.string().nullable(),
	score: z.string().nullable(),
	winner: z.string().nullable()
});
var matchplayResultsSchema = z.object({
	winners: z.object({ matchplay: z.string().optional() }),
	bracket: z.array(z.object({
		round: z.number(),
		matches: z.array(matchplayMatchSchema)
	}))
});
var hectorResultsSchema = z.object({
	teams: z.array(z.object({
		name: z.string(),
		players: z.array(z.string())
	})).optional(),
	winners: z.object({
		hector: z.array(z.string()).optional(),
		victor: z.array(z.string()).optional()
	}).optional()
}).optional();
var openingShotsRequirementSchema = z.object({
	minimumPerPlayer: z.number().min(0).max(9).optional(),
	penaltyPerMissingStroke: z.number().min(0).max(5).optional()
}).refine((data) => (data.minimumPerPlayer ?? 0) > 0 || !(data.penaltyPerMissingStroke ?? 0), { message: "penaltyPerMissingStroke requires a minimumPerPlayer greater than 0" });
var gameFormatNameSchema = z.enum([
	"Stableford NET",
	"Stableford SCR",
	"Stroke Play NET",
	"Stroke Play SCR",
	"Better Ball Stroke Play NET",
	"Better Ball Stroke Play SCR",
	"Better Ball Stableford NET",
	"Better Ball Stableford SCR",
	"Scramble Stroke Play NET",
	"Scramble Stableford NET"
]);
var gameFormatSchema = z.object({
	format: gameFormatNameSchema,
	competition: z.array(z.enum(["hector", "victor"])).optional(),
	handicapAllowance: z.number().optional(),
	contribution: z.object({
		hector: z.number().optional(),
		victor: z.number().optional()
	}).optional(),
	teamContribution: z.enum([
		"both",
		"better",
		"team"
	]).optional(),
	birdieBonus: z.number().optional(),
	eagleBonus: z.number().optional(),
	openingShotsRequirement: openingShotsRequirementSchema.optional()
}).refine((data) => !data.openingShotsRequirement || data.format.toLowerCase().includes("scramble"), {
	message: "openingShotsRequirement is only valid for Scramble game formats",
	path: ["openingShotsRequirement"]
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
var maxStrokesOverParValue = z.number().int().min(1).max(9);
/** The event-wide rule, and what every round plays unless it says otherwise. */
var eventMaxStrokesOverParSchema = maxStrokesOverParValue.optional().default(4);
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
var roundMaxStrokesOverParSchema = maxStrokesOverParValue.optional();
var hectorRoundSchema = z.object({
	day: z.number(),
	round: z.number(),
	course: z.string(),
	tee: z.string(),
	maxStrokesOverPar: roundMaxStrokesOverParSchema,
	gameFormats: z.array(gameFormatSchema)
});
var finnkampenResultsSchema = z.object({
	teams: z.array(z.object({
		name: z.string(),
		players: z.array(z.string())
	})),
	winners: z.object({ finnkampen: z.array(z.string()).optional() })
}).optional();
/**
* A calendar date, spelled "2026-09-24".
*
* An event carries its first and last day in this form rather than a prose range
* like "September 24-27, 2026". The prose is easy to write and hard to use: the day
* a given round is played is arithmetic on the start date, and arithmetic wants a
* date rather than a sentence to parse.
*/
var isoDateSchema = z.string().refine(isValidIsoDate, { message: "expected a calendar date in ISO format, e.g. 2026-09-24" });
/**
* When an event is played: its first day and its last.
*
* A one-day event repeats the same date, which keeps every reader of the pair
* honest — there is no "no end date" case for anyone to forget about.
*
* The two dates travel together in an object of their own so that the chronology
* check can live here, on the thing it is about. A refinement on the event itself
* would not survive `z.discriminatedUnion`, which rejects an option carrying one.
*/
var eventTimingSchema = z.object({
	/** The event's first day. Round day 1 is played on this date. */
	start: isoDateSchema,
	/** The event's last day, which for a one-day event is the start date again. */
	end: isoDateSchema
}).refine((timing) => timing.start <= timing.end, {
	message: "an event cannot end before it starts",
	path: ["end"]
});
var BaseEventSchema = z.object({
	id: z.string(),
	ignore: z.boolean().optional().default(false),
	name: z.string(),
	location: z.string(),
	timing: eventTimingSchema,
	hero_image: z.string().optional(),
	description: z.string().optional(),
	participants: z.array(z.string())
});
var EventFormat = /* @__PURE__ */ function(EventFormat) {
	EventFormat["Hector"] = "hector";
	EventFormat["Matchplay"] = "matchplay";
	EventFormat["Finnkampen"] = "finnkampen";
	return EventFormat;
}({});
var hectorEventSchema = BaseEventSchema.extend({
	format: z.literal(EventFormat.Hector),
	maxStrokesOverPar: eventMaxStrokesOverParSchema,
	courses: z.array(z.string()).optional(),
	rounds: z.array(hectorRoundSchema).optional(),
	buckets: z.array(z.array(z.object({
		id: z.string(),
		handicap: z.number().optional()
	}))).optional(),
	results: hectorResultsSchema.optional(),
	leaderboardSheet: z.string().optional()
});
var finnkampenEventSchema = BaseEventSchema.extend({
	format: z.literal(EventFormat.Finnkampen),
	courses: z.array(z.string()).optional(),
	results: finnkampenResultsSchema.optional()
});
/**
* Where a matchplay tournament is in its life.
*
* Optional, because the three events that predate the admin UI do not carry it.
* `matchplayStatus()` derives it from the data for those, so nothing had to be
* backfilled and no existing file became invalid.
*/
var matchplayStatusSchema = z.enum([
	"signup",
	"started",
	"complete"
]);
var matchplayEventSchema = BaseEventSchema.extend({
	format: z.literal(EventFormat.Matchplay),
	status: matchplayStatusSchema.optional(),
	results: matchplayResultsSchema.optional()
});
z.discriminatedUnion("format", [
	hectorEventSchema,
	matchplayEventSchema,
	finnkampenEventSchema
]);
/**
* A matchplay event's status, derived when the field is absent.
*
* Recorded winner means complete; a drawn bracket means started; anything else
* is still taking signups. Written status always wins, so the admin UI can move
* an event backwards if a draw was made too early.
*/
function matchplayStatus(event) {
	if (event.status) return event.status;
	if (event.results?.winners?.matchplay) return "complete";
	if ((event.results?.bracket?.length ?? 0) > 0) return "started";
	return "signup";
}
//#endregion
//#region ../packages/schemas/src/players.ts
var schema = z.object({
	id: z.string(),
	gender: z.enum(["male", "female"]).optional(),
	name: z.object({
		first: z.string(),
		last: z.string()
	}),
	privacy: z.enum(["shorten-last-name"]).optional(),
	aliases: z.array(z.object({
		first: z.string(),
		last: z.string()
	})).optional(),
	contact: z.object({ phone: z.string() }),
	image: z.string().optional(),
	club: z.string().optional(),
	handicap: z.number().optional(),
	misc: z.array(z.string()).optional(),
	biography: z.array(z.string()).optional()
});
//#endregion
//#region src/lib/repository/events.ts
var EVENTS = "events";
var PLAYERS = "players";
function parse(schema, raw, id) {
	const stored = raw;
	if (!stored?.doc) return void 0;
	const result = schema.safeParse(JSON.parse(stored.doc));
	if (!result.success) {
		console.error(`Stored document ${id} does not match its schema; skipping it`);
		return;
	}
	return result.data;
}
async function listMatchplayEvents() {
	return (await firestore().collection(EVENTS).get()).docs.map((d) => parse(matchplayEventSchema, d.data(), d.id)).filter((e) => e !== void 0).sort((a, b) => b.timing.start.localeCompare(a.timing.start));
}
async function getMatchplayEvent(id) {
	const doc = await firestore().collection(EVENTS).doc(id).get();
	return doc.exists ? parse(matchplayEventSchema, doc.data(), id) : void 0;
}
/**
* Validates before writing. The admin UI is the one writer that could put a
* malformed event into the store, so it is the one place worth refusing to.
*/
async function saveMatchplayEvent(event, updatedBy) {
	const validated = matchplayEventSchema.parse(event);
	const record = {
		doc: JSON.stringify(validated),
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		updatedBy
	};
	await firestore().collection(EVENTS).doc(validated.id).set(record);
}
async function eventExists(id) {
	return (await firestore().collection(EVENTS).doc(id).get()).exists;
}
async function listPlayers() {
	return (await firestore().collection(PLAYERS).get()).docs.map((d) => parse(schema, d.data(), d.id)).filter((p) => p !== void 0).sort((a, b) => `${a.name.first} ${a.name.last}`.localeCompare(`${b.name.first} ${b.name.last}`));
}
//#endregion
export { saveMatchplayEvent as a, formatEventDates as c, listPlayers as i, getMatchplayEvent as n, matchplayEventSchema as o, listMatchplayEvents as r, matchplayStatus as s, eventExists as t };
