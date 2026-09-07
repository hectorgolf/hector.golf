/**
 * Domain types for the mScorecard API.
 *
 * See astrosite/docs/mscorecard-api.md for the raw request/response shapes these
 * were derived from.
 */

/** "0" = female, "1" = male. Selects which set of tee ratings applies. */
export type Gender = "0" | "1";

/** "9" = WHS index, "0" = a plain club handicap that is used verbatim. */
export type HcpType = "9" | "0" | string;

/** 0 = Stroke Play, 1 = Stroke Play NET, 2 = Stableford. */
export type GameFormat = 0 | 1 | 2;

/**
 * Which of the course's nines is played, by index — not a boolean.
 *
 * A course names up to four nines and each tee carries four arrays of hole
 * lengths, so 1-4 are possible; `0` means "no nine here", which is how a
 * nine-hole round is expressed. The tee ratings and par tables are keyed by the
 * `<nine1>_<nine2>` pair (`ratings_1_1`, `ratings_1_2`, `ratings_2_2`), which is
 * both where the legal combinations come from and why playing one nine twice is
 * an ordinary thing to ask for.
 */
export type NineSelection = 0 | 1 | 2 | 3 | 4;

/** Everything needed to resume a session without re-sending the password. */
export type MScorecardSession = {
    email: string;
    /** Bearer credential for the `/api/v2.3` endpoints. Rotates as you use it. */
    accessToken: string;
    /** Hashed credential ("token" in the login response) for the legacy PHP endpoints. */
    legacyToken: string;
    userID: string;
};

/**
 * An entry in the logged-in user's own player roster.
 *
 * This is NOT an mScorecard account: `playerID` is minted client-side and is
 * meaningful only within this user's roster. A person with their own mScorecard
 * account still needs a roster entry before you can put them in a round.
 */
export type RosterPlayer = {
    name: string;
    playerID: string;
    shortName: string;
    email: string;
    gender: Gender;
    hcp: number;
    hcpType: HcpType;
    club: string;
    isDefaultPlayer: boolean;
    /**
     * 0 = a player of our own invention, 1 = a friend request sent and pending,
     * 2 = a friend link accepted, so this person keeps their own record.
     */
    friendStatus: FriendStatus;
    /** Their mScorecard user ID, or "0" for a player of our own invention. */
    friendUserID: string;
    /** Their playerID in *their* roster. Only set once the link is accepted. */
    friendPlayerID: string;
};

/** 0 = not a friend, 1 = request pending, 2 = accepted. */
export type FriendStatus = 0 | 1 | 2;

/** A hit from the friend search: somebody else's public profile. */
export type PlayerSearchHit = {
    firstName: string;
    lastName: string;
    name: string;
    shortName: string;
    country: string;
    club: string;
    hcp: number;
    gender: Gender;
    /** Their own mScorecard user ID. Never appears in round payloads. */
    userID: string;
    /** Their entry in YOUR roster, or undefined if you have not added them yet. */
    playerID?: string;
};

export type TeeRatings = {
    slope: number;
    cr: number;
    slopeW: number;
    crW: number;
};

export type Tee = {
    teeID: string;
    extTeeID: number;
    name: string;
    teeColor: string;
    teeNum: number;
    /** Hole lengths, one array per nine (four slots; unused nines are all zeroes). */
    lengths: number[][];
    /**
     * Course rating and slope, keyed `ratings_<nine1>_<nine2>`.
     *
     * Which keys exist depends on the facility: a two-nine course publishes only the
     * ascending pairs (1_1, 1_2, 2_2), while a three-nine course publishes all nine
     * combinations including the reversed ones. The values are order-independent —
     * Nevas Golf rates 1_2 and 2_1 identically — so a missing reversed key can be
     * looked up under its ascending equivalent.
     */
    [ratings: `ratings_${number}_${number}`]: TeeRatings | undefined;
};

export type CourseSummary = {
    courseID: string;
    courseName: string;
    clubName: string;
    city: string;
    state: string;
    country: string;
    latitude: string;
    longitude: string;
    numHoles: number;
};

/**
 * A round as it appears in the rounds list.
 *
 * Note there is no "finished" flag here: whether a round is complete only shows up
 * when the round itself is read.
 */
export type RoundSummary = {
    roundID: string;
    /** "YYYYMMDDHHmm", as sent when the round was created. */
    date: string;
    /** The server's own rendering of the date, e.g. "07-Sep-2026". */
    displayDate: string;
    clubName: string;
    /** The full name, e.g. "Tapiola Golf (Back 9)". */
    courseName: string;
    /** Just the course part, e.g. "Back 9". */
    course: string;
    /** Undefined when no scores have registered — the list shows "-" for that. */
    totalStrokes?: number;
    adjustedStrokes?: number;
    parDiff?: number;
    stableford?: number;
    holesPlayed?: number;
    /** Whether the round is set to count towards a handicap. */
    countsTowardsHandicap: boolean;
    /** Whether it has been submitted for handicap calculation. */
    submitted: boolean;
};

export type Course = {
    courseID: string;
    courseName: string;
    numHoles: number;
    numNines: number;
    nine1: number;
    nine2: number;
    club: {
        name: string;
        city: string;
        country: string;
        latitude: string;
        longitude: string;
        website: string;
    };
    tees: Tee[];
    /** Empty on most courses; set where the nines have names of their own. */
    nine1Name?: string;
    nine2Name?: string;
    nine3Name?: string;
    nine4Name?: string;
    /**
     * Par and stroke index per hole, keyed `parIndex_<nine1>_<nine2>`.
     *
     * Which keys exist tells you which combinations the course can be played in: a
     * two-nine course publishes 1_1, 1_2 and 2_2, while a three-nine course
     * publishes all nine, reversed orders included. Always 18 entries, and the order
     * follows the key — `parIndex_2_1` lists nine 2's pars first — so the pars for a
     * single nine are the first nine entries of that nine's own `_N_N` table.
     */
    [parIndex: `parIndex_${number}_${number}`]: ParIndex | undefined;
};

export type ParIndex = {
    pars: number[];
    indexes: number[];
};

/** One player as you specify them when creating a round. */
export type RoundPlayerSpec = {
    /**
     * Roster playerID. Must already exist server-side — the round PUT resolves the
     * name from it. For an accepted friend this is their `friendPlayerID`, not our
     * roster entry; `roundReferenceFor()` works out which to use.
     */
    playerID: string;
    /** Whose player record it is. Defaults to the logged-in user. */
    playerUserID?: string;
    teeID: string;
    /** The tee's index on the card. Absent from a round-creation response, so it
     * can be unknown when copying another player's tee. */
    extTeeID?: number;
    /**
     * Playing handicap for this round. The app computes this client-side and the
     * server stores whatever you send, so it is yours to decide.
     */
    courseHcp: number;
    /** The player's handicap going in, recorded on the scorecard. */
    hcpBefore: number;
    gender: Gender;
    /**
     * 1 = count this round towards the player's official handicap.
     *
     * Defaults to 0, so a round is a practice round unless it is deliberately made
     * otherwise — an accidental round cannot end up in anyone's handicap record.
     * `MScorecardRound.setCountsTowardsHandicap()` flips it later.
     */
    hcpRound?: 0 | 1;
    /** Percentage, defaults to 100. */
    hcpAllowance?: number;
    /** Defaults to 1. */
    groupNum?: number;
};

/**
 * A player's slot in a created round.
 *
 * `sid` is a scorecard *row* ID: it identifies this player in THIS round only, and
 * it is what every score write is keyed by. The same person gets a different `sid`
 * in their next round.
 */
export type RoundPlayerSlot = {
    sid: string;
    playerID: string;
    /**
     * Whose player record this is: our own user ID for a player we invented, and the
     * friend's for someone whose friend link has been accepted.
     */
    playerUserID: string;
    name: string;
    shortName: string;
    /** Position on the card, 1-based. Closes up when a player is removed. */
    playerNum: number;
    groupNum: number;
    courseHcp: number;
    hcpBefore: number;
    hcpAllowance: number;
    teeID: string;
    /** Absent from the round-creation response; carried over from the request. */
    extTeeID?: number;
    gender: Gender;
    /**
     * Whether this player's round counts towards their official handicap.
     *
     * Per player, not per round: in a group, one player can be posting a handicap
     * round while another is out for practice. Rounds are created with this off, and
     * `MScorecardRound.setCountsTowardsHandicap()` turns it on.
     */
    hcpRound: 0 | 1;
};

/** A single score entry. `-1` anywhere in the API means "not entered". */
export type HoleScore = {
    sid: string;
    /** The hole's number on the course: 10-18 for a back-nine round, not 1-9. */
    h: number;
    /** Strokes. */
    st: number;
    /** Putts. */
    pu?: number;
    /** Penalty strokes. */
    pe?: number;
    /** Fairway hit. */
    fw?: number;
    /** Club used off the tee. */
    cl?: string;
};

export type CreateRoundOptions = {
    courseID: string;
    /** The nine played on the front half of the card. Usually 1. */
    nine1: NineSelection;
    /** The nine played on the back half, or 0 for a nine-hole round. Usually 2. */
    nine2: NineSelection;
    players: RoundPlayerSpec[];
    /** Defaults to now. Serialised as "YYYYMMDDHHmm" in local time. */
    date?: Date;
    /**
     * How the round is scored. Defaults to 2, Stableford.
     *
     * It decides only how the card is presented and totalled — the strokes are the
     * same either way — and `MScorecardRound.setGameFormat()` changes it later.
     */
    gameFormat?: GameFormat;
    competitionName?: string;
    markerName?: string;
    numGroups?: number;
    /** Suppress push notifications to the other players. Defaults to true. */
    noNotifications?: boolean;
};
