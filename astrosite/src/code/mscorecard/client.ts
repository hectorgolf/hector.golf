import { MScorecardAuthError, MScorecardError } from "./errors.ts";
import { groupCoursesByFacility, type CourseFacility } from "./facilities.ts";
import { MScorecardTransport, type TransportOptions } from "./http.ts";
import { formatRoundDate, newPlayerID, newRoundID } from "./ids.ts";
import { describeRound, MScorecardRound, NOT_ENTERED } from "./round.ts";
import type {
    Course,
    CourseSummary,
    CreateRoundOptions,
    Gender,
    MScorecardSession,
    PlayerSearchHit,
    RosterPlayer,
    RoundPlayerSlot,
    RoundPlayerSpec,
    RoundSummary,
    FriendStatus,
} from "./types.ts";

const MAX_HOLES = 18;

/**
 * A client for the mScorecard backend.
 *
 * ```ts
 * const client = new MScorecardClient();
 * await client.login(email, password);
 *
 * const round = await client.createRound({
 *     courseID: "0121568050825406011",
 *     nine1: 1,
 *     nine2: 0,
 *     players: [
 *         { playerID: lasse.playerID, teeID: "208146", extTeeID: 5, courseHcp: 17, hcpBefore: 14.8, gender: "1" },
 *         { playerID: toni.playerID, teeID: "208146", extTeeID: 5, courseHcp: 36, hcpBefore: 36, gender: "1" },
 *     ],
 * });
 *
 * await round.scoreHole(1, { "Lasse Koskela": 5, "Toni Marttila": 4 });
 * await round.finish();
 * ```
 *
 * Two mScorecard quirks are handled for you: the access token rotates on almost
 * every response, and each round carries a `ts` version token that every write has
 * to echo. See `astrosite/docs/mscorecard-api.md` for the underlying protocol.
 */
export class MScorecardClient {
    private readonly transport: MScorecardTransport;

    constructor(options: TransportOptions = {}) {
        this.transport = new MScorecardTransport(options);
    }

    /** Everything needed to `resume()` later. The access token changes as you use the client. */
    get session(): MScorecardSession {
        return this.transport.session;
    }

    get userID(): string {
        return this.transport.userID;
    }

    /** Exchange an email and password for the two credentials the two backends need. */
    async login(email: string, password: string): Promise<MScorecardSession> {
        const body = await this.transport.postJsonAnonymous("auth/login", { email, password, returnToken: 1 });
        const accessToken = asString(body.accessToken);
        const legacyToken = asString(body.token);
        if (!accessToken || !legacyToken) {
            const reason = asString(body.msg) || "no access token in the response";
            throw new MScorecardAuthError(`Login failed for ${email}: ${reason}`);
        }
        this.transport.adopt({ email, accessToken, legacyToken, userID: asString(body.userID) ?? "" });
        return this.session;
    }

    /** Restore a previous session instead of sending the password again. */
    resume(session: MScorecardSession): void {
        this.transport.adopt(session);
    }

    // ------------------------------------------------------------------ courses

    async searchCourses(name: string, country = ""): Promise<CourseSummary[]> {
        const body = await this.transport.get("courses", { name, country, lat: "", lng: "", measure: "1" });
        return asArray(body.courses).map((raw) => ({
            courseID: asString(raw.courseID) ?? "",
            courseName: asString(raw.courseName) ?? "",
            clubName: asString(raw.clubName) ?? "",
            city: asString(raw.city) ?? "",
            state: asString(raw.state) ?? "",
            country: asString(raw.country) ?? "",
            latitude: asString(raw.latitude) ?? "",
            longitude: asString(raw.longitude) ?? "",
            numHoles: asNumber(raw.numHoles) ?? 0,
        }));
    }

    /**
     * Like `searchCourses`, but with a club's nine-pair variants collapsed into one
     * entry each - Nevas Golf's three pairings come back as a single facility.
     */
    async searchFacilities(name: string, country = ""): Promise<CourseFacility[]> {
        return groupCoursesByFacility(await this.searchCourses(name, country));
    }

    /** Full course detail: tees, ratings, pars and stroke indexes. */
    async getCourse(courseID: string): Promise<Course> {
        const body = await this.transport.get(`courses/${courseID}`);
        const course = body.course;
        if (!isObject(course)) {
            throw new MScorecardError(`No course ${courseID} in the response.`);
        }
        return course as unknown as Course;
    }

    // ------------------------------------------------------------------- players

    /**
     * The logged-in user's own player roster, including themselves.
     *
     * A round can only reference players that appear here — the round PUT sends no
     * names and resolves each `playerID` against this list.
     */
    async listRoster(): Promise<RosterPlayer[]> {
        const raw = await this.transport.legacyPost<unknown>("syncplayers.php", { download: "1", players: "" });
        return asArray(raw).map((entry) => ({
            name: asString(entry.name) ?? "",
            playerID: asString(entry.playerID) ?? "",
            shortName: asString(entry.shortName) ?? "",
            email: asString(entry.email) ?? "",
            gender: (asString(entry.gender) ?? "1") as Gender,
            hcp: asNumber(entry.hcp) ?? 0,
            hcpType: asString(entry.hcpType) ?? "0",
            club: asString(entry.club) ?? "",
            isDefaultPlayer: asNumber(entry.isDefaultPlayer) === 1,
            friendStatus: (asNumber(entry.friendStatus) ?? 0) as FriendStatus,
            friendUserID: asString(entry.friendUserID) ?? "0",
            friendPlayerID: asString(entry.friendPlayerID) ?? "",
        }));
    }

    /** Find a roster entry by name. Case-insensitive, exact match on the full name. */
    async findRosterPlayer(name: string): Promise<RosterPlayer | undefined> {
        const roster = await this.listRoster();
        return roster.find((player) => player.name.toLowerCase() === name.toLowerCase());
    }

    /**
     * Search other people's mScorecard profiles.
     *
     * The `userID` on a hit is that person's own account and is useless in round
     * payloads. What you need is `playerID` — their entry in *your* roster — which
     * is only set once you have added them.
     */
    async searchPlayers(searchString: string): Promise<PlayerSearchHit[]> {
        const raw = await this.transport.legacyPost<unknown>("findFriends.php", { searchString });
        return asArray(raw).map((entry) => ({
            firstName: asString(entry.FirstName) ?? "",
            lastName: asString(entry.LastName) ?? "",
            name: asString(entry.Name) ?? "",
            shortName: asString(entry.ShortName) ?? "",
            country: asString(entry.Country) ?? "",
            club: asString(entry.Club) ?? "",
            hcp: asNumber(entry.Hcp) ?? 0,
            gender: `${asNumber(entry.Gender) ?? 1}` as Gender,
            userID: asString(entry.ID) ?? "",
            playerID: asString(entry.PID) ?? undefined,
        }));
    }

    /**
     * Send a friend request to another mScorecard user.
     *
     * `userID` is the `userID` from a `searchPlayers()` hit — that person's own
     * account, not anything in our roster. The request adds them to the roster
     * straight away with `friendStatus: 1`; it becomes 2, and gains their own
     * `friendPlayerID`, once they accept.
     *
     * Call `listRoster()` afterwards to pick up the entry the server created, since
     * this returns nothing useful of its own.
     */
    async addFriend(userID: string): Promise<void> {
        await this.transport.legacyPost<unknown>("addFriend.php", { toUID: userID, fromPID: "", toEmail: "" });
    }

    /**
     * Add someone to the roster and return their new `playerID`.
     *
     * This is for a player of your own invention. To add a real mScorecard user, use
     * `addFriend()` instead — a friend is created by their user ID through a
     * different endpoint entirely, and only that route produces the friend link a
     * round needs.
     *
     * NOTE: the upload direction of `syncplayers.php` is still not present in any
     * capture — every one of them uses `download=1`. The payload shape here is
     * inferred from the download shape and should be verified before you rely on it.
     */
    async addRosterPlayer(player: {
        name: string;
        gender: Gender;
        hcp: number;
        hcpType?: string; // "9" for WHS
        shortName?: string;
        email?: string;
        club?: string;
        playerID?: string;
    }): Promise<string> {
        const playerID = player.playerID ?? newPlayerID();
        await this.transport.legacyPost<unknown>("syncplayers.php", {
            download: "0",
            players: JSON.stringify([
                {
                    name: player.name,
                    playerID,
                    shortName: player.shortName ?? initialsOf(player.name),
                    email: player.email ?? "",
                    gender: player.gender,
                    hcp: player.hcp,
                    hcpType: player.hcpType ?? "0",
                    club: player.club ?? "",
                },
            ]),
        });
        return playerID;
    }

    // -------------------------------------------------------------------- rounds

    /**
     * Create a round and get back a handle with one `sid` per player.
     *
     * You do not supply the `sid`s: each player is sent with a negative placeholder
     * ID (`-1`, `-2`, …) alongside their roster `playerID`, and the server echoes the
     * real `sid` back paired with the placeholder that produced it (`oldSid`).
     */
    async createRound(options: CreateRoundOptions): Promise<MScorecardRound> {
        if (options.players.length === 0) {
            throw new MScorecardError("A round needs at least one player.");
        }
        const roundID = newRoundID();
        const descriptor = describeRound({ ...options, roundID });

        const scores = options.players.map((player, index) => ({
            ID: -(index + 1), // placeholder; the response maps it back via oldSid
            modified: 1,
            courseHcp: player.courseHcp,
            teeID: player.teeID,
            extTeeID: player.extTeeID,
            playerNum: index + 1,
            groupNum: player.groupNum ?? 1,
            hcpAllowance: player.hcpAllowance ?? 100,
            hcpBefore: player.hcpBefore,
            hcpRound: player.hcpRound ?? 0,
            playerID: player.playerID,
            // Ours unless the caller says otherwise, which it does for a friend.
            playerUserID: player.playerUserID ?? this.transport.userID,
            gender: player.gender,
        }));

        const body = await this.transport.put(`rounds/${roundID}`, {
            ts: 0, // 0 means "this round is new"
            submitHcpRound: 0,
            round: {
                roundID,
                courseID: options.courseID,
                nine1: options.nine1,
                nine2: options.nine2,
                courseChanged: 1,
                date: descriptor.date,
                hcpRoundSubmitted: 0,
                numGroups: descriptor.numGroups,
                numPlayers: options.players.length,
                markerName: descriptor.markerName,
                finished: 0,
                noNotifications: descriptor.noNotifications ? 1 : 0,
                competitionName: descriptor.competitionName,
                scores,
                scoresDeleted: [],
                modifiedFields: null,
                showAdjustedScore: 0,
                gameFormat: descriptor.gameFormat,
            },
        });

        const { ts, slots, cards, course } = readRoundResponse(body, roundID, this.transport.userID);

        // A playerID the server could not resolve is dropped silently, which would
        // otherwise surface much later as a missing sid.
        for (const player of options.players) {
            if (!slots.some((slot) => slot.playerID === player.playerID)) {
                throw new MScorecardError(
                    `Round ${roundID} came back without a sid for playerID ${player.playerID}. ` +
                        `That player is probably not in this account's roster yet — add them first.`,
                );
            }
        }
        for (const slot of slots) {
            slot.extTeeID ??= options.players.find((p) => p.playerID === slot.playerID)?.extTeeID;
        }
        return new MScorecardRound(this.transport, descriptor, slots, ts, cards, course);
    }

    /**
     * The account's rounds, newest first.
     *
     * This is the quickest way to tell whether a card actually registered:
     * `totalStrokes` is undefined (the API sends `"-"`) when nothing did. It carries
     * no "finished" flag, so that has to come from reading the round itself.
     */
    async listRounds(): Promise<RoundSummary[]> {
        const body = await this.transport.get("rounds", { pid: "0" });
        return asArray(body.rounds).map((raw) => ({
            roundID: asString(raw.RoundID) ?? "",
            date: asString(raw.Date) ?? "",
            displayDate: asString(raw.RoundDate) ?? "",
            clubName: asString(raw.ClubName) ?? "",
            courseName: asString(raw.CourseName) ?? "",
            course: asString(raw.Course) ?? "",
            totalStrokes: asNumber(raw.TotalStrokes),
            adjustedStrokes: asNumber(raw.AdjustedStrokes),
            parDiff: asNumber(raw.ParDiff),
            stableford: asNumber(raw.Stableford),
            holesPlayed: asNumber(raw.NumHolesPlayed),
            countsTowardsHandicap: asNumber(raw.HcpRound) === 1,
            // "2" appears on old rounds that have since been processed.
            submitted: (asNumber(raw.HcpRoundSubmitted) ?? 0) > 0,
        }));
    }

    /**
     * Add a player to a round that already exists.
     *
     * Only the *new* row goes out — not the players already on the card. That is
     * what the app does, and it is the opposite of a removal, which re-sends every
     * survivor alongside `scoresDeleted`. The row carries the placeholder `ID: -1`
     * exactly as at creation, `numPlayers` is the new total, and `playerNum` is the
     * position being taken.
     *
     * The reply names the row it created, with `oldSid: -1` pointing back at the
     * placeholder, so the new `sid` comes straight back without re-reading.
     */
    async addPlayerToRound(round: MScorecardRound, player: RoundPlayerSpec): Promise<RoundPlayerSlot> {
        const playerNum = round.players.length + 1;
        const body = await this.transport.put(`rounds/${round.roundID}`, {
            ts: round.ts,
            submitHcpRound: 0,
            round: {
                roundID: round.roundID,
                courseID: round.descriptor.courseID,
                nine1: round.descriptor.nine1,
                nine2: round.descriptor.nine2,
                courseChanged: 0,
                date: round.descriptor.date,
                hcpRoundSubmitted: 0,
                numGroups: round.descriptor.numGroups,
                numPlayers: playerNum,
                markerName: round.descriptor.markerName,
                finished: round.isFinished ? 1 : 0,
                noNotifications: round.descriptor.noNotifications ? 1 : 0,
                competitionName: round.descriptor.competitionName,
                userID: this.transport.userID,
                showAdjustedScore: 0,
                gameFormat: round.descriptor.gameFormat,
                scores: [
                    {
                        ID: -1, // placeholder, as at creation
                        modified: 1,
                        courseHcp: player.courseHcp,
                        teeID: player.teeID,
                        extTeeID: player.extTeeID,
                        playerNum,
                        groupNum: player.groupNum ?? 1,
                        hcpAllowance: player.hcpAllowance ?? 100,
                        hcpBefore: player.hcpBefore,
                        hcpRound: player.hcpRound ?? 0,
                        playerID: player.playerID,
                        playerUserID: player.playerUserID ?? this.transport.userID,
                        gender: player.gender,
                    },
                ],
                scoresDeleted: [],
                modifiedFields: [],
            },
        });

        const { ts, slots } = readRoundResponse(body, round.roundID, this.transport.userID);
        const added = slots.find((slot) => slot.playerID === player.playerID);
        if (!added) {
            throw new MScorecardError(
                `Round ${round.roundID} came back without the player that was just added. ` +
                    `The request was accepted but changed nothing.`,
            );
        }
        round.acceptAddedPlayer(added, ts);
        return added;
    }

    /**
     * Delete a round by ID.
     *
     * The whole request is the round ID in the URL: no body, and no `ts` version
     * token, which makes this the one write you can make without having read the
     * round first. There is no undo. Use `MScorecardRound.delete()` instead when you
     * already hold a handle, so it can stop accepting scores.
     */
    async deleteRound(roundID: string): Promise<void> {
        await this.transport.delete(`rounds/${roundID}`);
    }

    /**
     * Re-open an existing round, recovering its `sid`s, current `ts` and scorecards.
     *
     * The GET shape differs from the round-creation response in almost every name —
     * `ID` rather than `sid`, `strokes` rather than `st`, the player nested rather
     * than flat — so both are accepted.
     */
    async openRound(roundID: string): Promise<MScorecardRound> {
        const body = await this.transport.get(`rounds/${roundID}`);
        const { ts, slots, cards, round, course } = readRoundResponse(body, roundID, this.transport.userID);
        const descriptor = describeRound({
            roundID,
            courseID: asString(round.courseID) ?? "",
            nine1: (asNumber(round.nine1) ?? 1) as CreateRoundOptions["nine1"],
            nine2: (asNumber(round.nine2) ?? 0) as CreateRoundOptions["nine2"],
            // Whatever the round says, not the creation default: this is a read.
            gameFormat: (asNumber(round.gameFormat) ?? 0) as CreateRoundOptions["gameFormat"],
            competitionName: asString(round.competitionName) ?? "",
            markerName: asString(round.markerName) ?? "",
            numGroups: asNumber(round.numGroups) ?? 1,
        });
        // The server's date is already in wire format, so keep it rather than "now".
        const date = asString(round.date);
        return new MScorecardRound(
            this.transport,
            { ...descriptor, date: date ?? formatRoundDate(new Date()) },
            slots,
            ts,
            cards,
            course,
            {
                finished: asNumber(round.finished) === 1,
                // "2" appears on old rounds the federation has since processed.
                submitted: (asNumber(round.hcpRoundSubmitted) ?? 0) > 0,
            },
        );
    }
}

/** Pulls the sid map, version token and current cards out of a round payload. */
function readRoundResponse(
    body: Record<string, unknown>,
    roundID: string,
    /** Whose account this is, used when a score row does not name an owner. */
    ownUserID: string,
): {
    ts: string;
    slots: RoundPlayerSlot[];
    cards: Map<string, number[]>;
    round: Record<string, unknown>;
    course?: Course;
} {
    const round = isObject(body.round) ? body.round : {};
    const ts = asString(body.ts) ?? asString(round.ts);
    if (!ts) {
        throw new MScorecardError(`Round ${roundID} response carried no ts version token, so it cannot be written to.`);
    }

    // The stored card is indexed by course hole: a back-nine round holds hole 10 at
    // index 9. Our cards are indexed by position on the card, so they need mapping.
    const holes = holesInPlay(asNumber(round.nine1) ?? 1, asNumber(round.nine2) ?? 0);

    const cards = new Map<string, number[]>();
    const slots = asArray(round.scores).map((raw, index) => {
        // Creating a round and reading one back do not agree on field names: the PUT
        // response calls the row `sid` with a `st` card and a flat `name`, while the
        // GET calls it `ID` with a `strokes` card and the name nested under `player`.
        const sid = asString(raw.sid) ?? asString(raw.ID);
        if (!sid) {
            throw new MScorecardError(`Round ${roundID} returned a player with no sid at position ${index}.`);
        }
        const raw_strokes = raw.st ?? raw.strokes;
        const strokes = Array.isArray(raw_strokes) ? raw_strokes.map((value) => asNumber(value) ?? NOT_ENTERED) : [];
        cards.set(sid, cardFromCourseHoles(strokes, holes));
        const embedded = isObject(raw.player) ? raw.player : {};
        return {
            sid,
            playerID: asString(raw.playerID) ?? asString(embedded.playerID) ?? "",
            playerUserID: asString(raw.playerUserID) ?? ownUserID,
            name: asString(raw.name) ?? asString(embedded.name) ?? "",
            shortName: asString(raw.shortName) ?? asString(embedded.shortName) ?? "",
            playerNum: asNumber(raw.playerNum) ?? index + 1,
            groupNum: asNumber(raw.groupNum) ?? 1,
            // Creating spells these `hcp` and `allowance`; reading back uses the
            // longer names. Both are accepted, as everywhere else in this reader.
            courseHcp: asNumber(raw.hcp) ?? asNumber(raw.courseHcp) ?? 0,
            hcpBefore: asNumber(raw.hcpBefore) ?? 0,
            hcpAllowance: asNumber(raw.allowance) ?? asNumber(raw.hcpAllowance) ?? 100,
            teeID: asString(raw.teeID) ?? "",
            extTeeID: asNumber(raw.extTeeID),
            gender: ((asString(raw.gender) ?? asString(embedded.gender) ?? "1") as Gender),
            hcpRound: (asNumber(raw.hcpRound) === 1 ? 1 : 0) as 0 | 1,
        };
    });
    const course = isObject(round.course) ? (round.course as unknown as Course) : undefined;
    return { ts, slots, cards, round, course };
}

/** The course hole numbers a nine configuration plays, in order. */
function holesInPlay(nine1: number, nine2: number): number[] {
    const nine = (n: number) => Array.from({ length: 9 }, (_, index) => (n - 1) * 9 + index + 1);
    return nine2 ? [...nine(nine1), ...nine(nine2)] : nine(nine1);
}

/**
 * Turns the server's course-hole-indexed array into a card indexed by position.
 *
 * For an 18-hole round the two are the same; for a back-nine round the score for
 * hole 10 moves from index 9 to index 0.
 */
function cardFromCourseHoles(strokes: number[], holes: readonly number[]): number[] {
    const card = new Array<number>(MAX_HOLES).fill(NOT_ENTERED);
    holes.forEach((hole, position) => {
        const value = strokes[hole - 1];
        if (value !== undefined && position < MAX_HOLES) card[position] = value;
    });
    return card;
}

function initialsOf(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isObject) : [];
}

function asString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number") return `${value}`;
    return undefined;
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
    return undefined;
}
