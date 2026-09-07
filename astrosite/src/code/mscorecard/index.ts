/**
 * A TypeScript SDK for the mScorecard backend.
 *
 * The protocol it wraps is documented in `astrosite/docs/mscorecard-api.md`.
 */

export { MScorecardClient } from "./client.ts";
export { MScorecardRound, describeRound, NOT_ENTERED } from "./round.ts";
export { facilityIdOf, ninePairOf, groupCoursesByFacility, courseForNines } from "./facilities.ts";
export { roundReferenceFor } from "./roster.ts";
export { playingHandicapFor, strokesReceived, stablefordPoints, totalStableford } from "./scoring.ts";
export type { CourseFacility } from "./facilities.ts";
export type { PlayerRef, RoundDescriptor, ScoreEntry } from "./round.ts";
export { MScorecardTransport, DEFAULT_API_BASE_URL, DEFAULT_LEGACY_BASE_URL } from "./http.ts";
export type { FetchLike, TransportOptions } from "./http.ts";
export { formatRoundDate, newPlayerID, newRoundID } from "./ids.ts";
export type { Clock } from "./ids.ts";
export {
    MScorecardError,
    MScorecardHttpError,
    MScorecardAuthError,
    MScorecardConflictError,
    MScorecardNotEditableError,
} from "./errors.ts";
export type * from "./types.ts";
