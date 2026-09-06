import { MScorecardConflictError, MScorecardError, MScorecardNotEditableError } from "./errors.ts";
import type { MScorecardTransport } from "./http.ts";
import { formatRoundDate } from "./ids.ts";
import type { Course, GameFormat, HoleScore, NineSelection, RoundPlayerSlot } from "./types.ts";

/** How to refer to a player when writing scores: their slot, `sid`, `playerID`, or name. */
export type PlayerRef = RoundPlayerSlot | string;

/** One player's score on one hole, plus optional detail the app also records. */
export type ScoreEntry = Omit<HoleScore, "sid" | "h" | "st"> & {
    player: PlayerRef;
    hole: number;
    strokes: number;
};

/** The immutable description of a round, needed to re-send the envelope on PUT. */
export type RoundDescriptor = {
    roundID: string;
    courseID: string;
    nine1: NineSelection;
    nine2: NineSelection;
    date: string;
    gameFormat: GameFormat;
    competitionName: string;
    markerName: string;
    numGroups: number;
    noNotifications: boolean;
};

/** `-1` is how mScorecard spells "not entered". */
export const NOT_ENTERED = -1;

const MAX_HOLES = 18;
const HOLES_PER_NINE = 9;

/** The format a new round gets unless asked for otherwise. */
const STABLEFORD: GameFormat = 2;

/**
 * A live handle on one round.
 *
 * This owns the two pieces of mutable state that make the API awkward to call
 * directly:
 *
 *  - **the `sid` map.** A `sid` is a scorecard *row* ID — it identifies a player in
 *    this round only, and the server mints it during round creation. You never
 *    invent one, and it is unrelated to the player's `playerID` or user ID. This
 *    class lets you name players however is convenient and resolves the `sid` for you.
 *  - **the `ts` chain.** Every write must echo the `ts` from the previous response
 *    on this round, and receives the next one. Writes are serialised so concurrent
 *    calls cannot break the chain.
 */
export class MScorecardRound {
    private readonly cards = new Map<string, number[]>();
    /** Serialises writes: two overlapping calls would both send the same stale `ts`. */
    private pending: Promise<unknown> = Promise.resolve();
    private version: string;
    private readonly slots: RoundPlayerSlot[] = [];
    private finished = false;
    private submitted = false;
    private editable = true;
    private deleted = false;

    constructor(
        private readonly transport: MScorecardTransport,
        readonly descriptor: RoundDescriptor,
        players: readonly RoundPlayerSlot[],
        ts: string,
        cards?: Map<string, number[]>,
        /**
         * The course as the *server* has it for this round, when it sent one.
         *
         * Reading a round back embeds a snapshot carrying the par and stroke-index
         * tables, which is the only way to check that the server agrees with us about
         * which holes were played rather than merely echoing our own numbers.
         */
        readonly course?: Course,
        /** The state the server already holds, when the round was read rather than created. */
        state?: { finished?: boolean; submitted?: boolean },
    ) {
        this.version = ts;
        this.slots = [...players];
        this.finished = state?.finished ?? false;
        this.submitted = state?.submitted ?? false;
        for (const player of players) {
            this.cards.set(player.sid, cards?.get(player.sid)?.slice() ?? new Array(MAX_HOLES).fill(NOT_ENTERED));
        }
    }

    get roundID(): string {
        return this.descriptor.roundID;
    }

    /** The players on this card, in playing order. */
    get players(): readonly RoundPlayerSlot[] {
        return this.slots;
    }

    /** The current version token. Every write consumes it and produces the next one. */
    get ts(): string {
        return this.version;
    }

    get isFinished(): boolean {
        return this.finished;
    }

    /** Whether this round has been forwarded for official handicap calculation. */
    get isSubmitted(): boolean {
        return this.submitted;
    }

    get isDeleted(): boolean {
        return this.deleted;
    }

    /**
     * Whether the round can still be scored.
     *
     * Optimistic: the server only reveals a lock by ignoring a write, so this turns
     * false once that has happened rather than predicting it.
     */
    get isEditable(): boolean {
        return this.editable && !this.finished && !this.deleted;
    }

    /** 9 or 18, depending on whether a second nine is in play. */
    get numHoles(): number {
        return (this.descriptor.nine1 ? 9 : 0) + (this.descriptor.nine2 ? 9 : 0);
    }

    /**
     * The course hole numbers this round plays, in the order they are played.
     *
     * A back-nine round returns `[10, 11, … 18]`, and those are the numbers the API
     * wants: `h` on a score is the hole's number **on the course**, not its position
     * on the card. The two coincide on the front nine, which is why it is easy to get
     * wrong — a back-nine round scored with `h: 1..9` is accepted and then shows no
     * scores at all.
     *
     * A nine played twice repeats its numbers; how the server tells the two passes
     * apart is not something any capture shows.
     */
    get holes(): number[] {
        const holesOfNine = (nine: NineSelection) =>
            Array.from({ length: HOLES_PER_NINE }, (_, index) => (nine - 1) * HOLES_PER_NINE + index + 1);
        const { nine1, nine2 } = this.descriptor;
        return nine2 ? [...holesOfNine(nine1), ...holesOfNine(nine2)] : holesOfNine(nine1);
    }

    /**
     * Resolve a player reference to their `sid`.
     *
     * Accepts a slot from `players`, a `sid`, a roster `playerID`, or a name. The
     * lookup is tried in that order, so an ambiguous string resolves to the `sid`.
     */
    sidFor(ref: PlayerRef): string {
        if (typeof ref !== "string") return ref.sid;
        const match =
            this.players.find((p) => p.sid === ref) ??
            this.players.find((p) => p.playerID === ref) ??
            this.players.find((p) => p.name === ref);
        if (!match) {
            const known = this.players.map((p) => `${p.name} (sid ${p.sid}, playerID ${p.playerID})`).join(", ");
            throw new MScorecardError(`No player "${ref}" in round ${this.roundID}. Players are: ${known}`);
        }
        return match.sid;
    }

    /** The player's scorecard as this client knows it. `-1` means "not entered". */
    card(ref: PlayerRef): number[] {
        return (this.cards.get(this.sidFor(ref)) ?? []).slice();
    }

    /**
     * Write one or more scores.
     *
     * Order does not matter — `sid` identifies the row — and you can mix holes and
     * players freely in a single call, which is one round-trip instead of many.
     */
    async score(entries: ScoreEntry[]): Promise<void> {
        if (entries.length === 0) return;
        // `h` goes out as the course hole number; the card we keep is indexed by
        // position, matching the eighteen-slot array the API reads back.
        const written = entries.map(({ player, hole, strokes, ...detail }) => ({
            position: this.positionOf(hole),
            score: { ...detail, sid: this.sidFor(player), h: hole, st: strokes } satisfies HoleScore,
        }));
        const scores = written.map(({ score }) => score);
        await this.write(async () => {
            const body = await this.transport.patch(`rounds/${this.roundID}`, { ts: this.version, scores });
            this.acceptTs(body);
            this.assertWasEdited(body);
            for (const { position, score } of written) {
                const card = this.cards.get(score.sid);
                if (card) card[position] = score.st;
            }
        });
    }

    /** Everybody's strokes on one hole, in a single request. */
    async scoreHole(hole: number, strokesByPlayer: Record<string, number> | Map<PlayerRef, number>): Promise<void> {
        const pairs = strokesByPlayer instanceof Map ? [...strokesByPlayer] : Object.entries(strokesByPlayer);
        await this.score(pairs.map(([player, strokes]) => ({ player, hole, strokes })));
    }

    /** One player's whole card. Entries that are `-1` or `undefined` are skipped. */
    async scorePlayer(player: PlayerRef, strokes: ReadonlyArray<number | undefined>): Promise<void> {
        const holes = this.holes;
        const entries = strokes.flatMap((value, index) =>
            value === undefined || value === NOT_ENTERED ? [] : [{ player, hole: holes[index]!, strokes: value }],
        );
        await this.score(entries);
    }

    /**
     * Mark the round complete. Scores can no longer be written afterwards.
     *
     * Idempotent: finishing an already-finished round does nothing rather than
     * failing, and a finished round can still be submitted for handicap
     * calculation — so `finish()` followed by `submitForHandicap()` is fine.
     */
    async finish(): Promise<void> {
        if (this.finished) return;
        await this.write(async () => {
            // It may have finished while this call was queued behind another write.
            if (this.finished) return;
            const body = await this.transport.put(`rounds/${this.roundID}`, {
                ts: this.version,
                submitHcpRound: 0,
                round: {
                    ...this.envelope(),
                    finished: 1,
                    scores: [],
                    scoresDeleted: [],
                    modifiedFields: [],
                },
            });
            this.acceptTs(body);
            this.finished = true;
        });
    }

    /** Whether this player's round is set to count towards their official handicap. */
    countsTowardsHandicap(player: PlayerRef): boolean {
        return this.slotFor(player).hcpRound === 1;
    }

    /**
     * Turn a player's round into a handicap round, or back into a practice round.
     *
     * `hcpRound` is per player, so in a group one person can be posting a score while
     * another is only out for practice. Rounds are created with it off, which is why
     * this exists: submitting a round nobody has switched on would achieve nothing.
     *
     * NOTE: no capture shows the app toggling this on its own, so the request is
     * modelled on the handicap submission, which carries the same score rows with
     * `submitHcpRound: 0`. It does not finish the round or submit anything.
     */
    async setCountsTowardsHandicap(player: PlayerRef, counts: boolean): Promise<void> {
        const slot = this.slotFor(player);
        const wanted = counts ? 1 : 0;
        if (slot.hcpRound === wanted) return;

        await this.write(
            async () => {
                if (slot.hcpRound === wanted) return;
                const previous = slot.hcpRound;
                slot.hcpRound = wanted;
                try {
                    const body = await this.transport.put(`rounds/${this.roundID}`, {
                        ts: this.version,
                        submitHcpRound: 0,
                        round: {
                            ...this.envelope(),
                            finished: this.finished ? 1 : 0,
                            // Only the row that changed, and without a card: this
                            // edit is not about scores.
                            scores: [this.scoreRow(slot, { modified: 1, withCard: false })],
                            scoresDeleted: [],
                            modifiedFields: [],
                        },
                    });
                    this.acceptTs(body);
                } catch (error) {
                    slot.hcpRound = previous; // the server did not take it
                    throw error;
                }
            },
            // A finished round can still be re-flagged before it is submitted.
            { allowFinished: true },
        );
    }

    /**
     * Finish the round and submit it for official handicap calculation.
     *
     * Unlike `finish()`, this re-sends every player's full card, so only players
     * whose slot was created with `hcpRound: 1` are worth submitting. A marker name
     * is required by the app's own UI; pass one unless you know otherwise.
     *
     * Works on a round that is already finished, and is itself idempotent — a second
     * call does nothing rather than forwarding the round to the golf association
     * twice.
     */
    async submitForHandicap(markerName = this.descriptor.markerName): Promise<void> {
        if (this.submitted) return;
        if (!this.players.some((player) => player.hcpRound === 1)) {
            throw new MScorecardError(
                `No player in round ${this.roundID} is set to count towards a handicap, so there is nothing ` +
                    `to submit. Call setCountsTowardsHandicap(player, true) first.`,
            );
        }
        await this.write(
            async () => {
                // It may have been submitted while this call was queued.
                if (this.submitted) return;
                const scores = this.players.map((player) =>
                    this.scoreRow(player, { modified: 0, withCard: true }),
                );
                const body = await this.transport.put(`rounds/${this.roundID}`, {
                    ts: this.version,
                    submitHcpRound: 1,
                    round: {
                        ...this.envelope(),
                        markerName,
                        finished: 1,
                        hcpRoundSubmitted: 1,
                        noNotifications: 0,
                        userID: this.transport.userID,
                        scores,
                        scoresDeleted: [],
                        modifiedFields: [],
                    },
                });
                this.acceptTs(body);
                this.finished = true;
                this.submitted = true;
            },
            // Submitting a round we already finished is the normal sequence.
            { allowFinished: true },
        );
    }

    /**
     * Change when the round was played.
     *
     * A round-level edit sends no scores at all, and names what changed in
     * `modifiedFields` — the one place any capture puts something in that array;
     * finishing, submitting, adding and removing all leave it empty. The date is in
     * local time, so 17:10 in Helsinki goes out as `202609061710`.
     *
     * Allowed on a finished round, refused on a submitted one: the federation has
     * that one, and the date it was played is part of what they were told.
     */
    async setDate(when: Date): Promise<void> {
        const date = formatRoundDate(when);
        if (date === this.descriptor.date) return;
        // The date change is the one write any capture puts something in
        // `modifiedFields`, and the one that sets `courseChanged` on an edit.
        await this.editRound("date", { date, courseChanged: 1 }, [{ date }]);
        this.descriptor.date = date;
    }

    /**
     * Change how the round is scored.
     *
     * 0 is Stroke Play, 1 Stroke Play NET, 2 Stableford. This only decides how the
     * card is presented and totalled; the strokes themselves are untouched.
     *
     * Unlike the date, this leaves `modifiedFields` empty — so that array is not a
     * general record of what changed, whatever it looks like.
     */
    async setGameFormat(format: GameFormat): Promise<void> {
        if (format === this.descriptor.gameFormat) return;
        await this.editRound("game format", { gameFormat: format, courseChanged: 0 }, []);
        this.descriptor.gameFormat = format;
    }

    /**
     * A round-level edit: the whole envelope with the new value, and no scores.
     *
     * Allowed on a finished round, refused on a submitted one — the federation has
     * that one, and what it was told is part of the record.
     */
    private async editRound(
        what: string,
        changes: Record<string, unknown>,
        modifiedFields: Array<Record<string, unknown>>,
    ): Promise<void> {
        if (this.submitted) {
            throw new MScorecardError(
                `Round ${this.roundID} has been submitted for handicap calculation, so its ${what} cannot be changed.`,
            );
        }
        await this.write(
            async () => {
                const body = await this.transport.put(`rounds/${this.roundID}`, {
                    ts: this.version,
                    submitHcpRound: 0,
                    round: {
                        ...this.envelope(),
                        ...changes,
                        finished: this.finished ? 1 : 0,
                        userID: this.transport.userID,
                        scores: [],
                        scoresDeleted: [],
                        modifiedFields,
                    },
                });
                this.acceptTs(body);
            },
            { allowFinished: true },
        );
    }

    /**
     * Adopt a player the server has just added, and the version token that came with
     * it. Called by `MScorecardClient.addPlayerToRound`; not meant for anyone else.
     */
    acceptAddedPlayer(slot: RoundPlayerSlot, ts: string): void {
        this.slots.push(slot);
        this.cards.set(slot.sid, new Array(MAX_HOLES).fill(NOT_ENTERED));
        this.version = ts;
    }

    /**
     * Take a player off the card.
     *
     * Their scores go with them. The request names the row in `scoresDeleted` and
     * re-sends everyone who is left, renumbered — the app closes the gap in
     * `playerNum` rather than leaving a hole, so removing the first of three leaves
     * the others as 1 and 2.
     *
     * Removing the last player is refused: an empty round is better deleted.
     */
    async removePlayer(player: PlayerRef): Promise<void> {
        const going = this.slotFor(player);
        if (this.slots.length === 1) {
            throw new MScorecardError(
                `${going.name} is the only player in round ${this.roundID}. Delete the round instead.`,
            );
        }

        await this.write(async () => {
            const staying = this.slots.filter((slot) => slot.sid !== going.sid);
            const body = await this.transport.put(`rounds/${this.roundID}`, {
                ts: this.version,
                submitHcpRound: 0,
                round: {
                    ...this.envelope(),
                    finished: this.finished ? 1 : 0,
                    numPlayers: staying.length,
                    scores: staying.map((slot, index) =>
                        this.scoreRow(slot, { modified: 1, withCard: false, playerNum: index + 1 }),
                    ),
                    scoresDeleted: [{ ID: going.sid }],
                    modifiedFields: [],
                },
            });
            this.acceptTs(body);

            this.cards.delete(going.sid);
            this.slots.splice(0, this.slots.length, ...staying);
            this.slots.forEach((slot, index) => (slot.playerNum = index + 1));
        });
    }

    /**
     * Delete the round outright.
     *
     * Unlike every other write this one sends no body and no `ts` — the round ID in
     * the URL is the entire request — and it works on a finished round too. There is
     * no undo: the round and every player's scores in it are gone.
     */
    async delete(): Promise<void> {
        if (this.deleted) return;
        // Let any score already in flight settle first, rather than racing it.
        await this.pending.catch(() => undefined);
        await this.transport.delete(`rounds/${this.roundID}`);
        this.deleted = true;
    }

    /**
     * One score row, in the shape the app sends.
     *
     * Every field here appears in the captured payloads — `teeID`, `extTeeID`,
     * `hcpAllowance`, `hcpBefore`, `gender` and `hcpRound` included. Leaving any of
     * them out risks the server filling in a default, and `hcpRound` in particular
     * decides whether the round counts at all.
     *
     * The two variables are `modified` and whether the card rides along, and the app
     * uses them differently per operation: a handicap submission sends every row with
     * `modified: 0` *and* the full card, while changing a flag sends only the row
     * that changed, with `modified: 1` and no card at all. Attaching a card to an
     * edit that is not about scores would rewrite what is already there.
     */
    private scoreRow(
        player: RoundPlayerSlot,
        options: { modified: 0 | 1; withCard: boolean; playerNum?: number },
    ): Record<string, unknown> {
        const row: Record<string, unknown> = {
            ID: player.sid,
            modified: options.modified,
            courseHcp: player.courseHcp,
            teeID: player.teeID,
            extTeeID: player.extTeeID,
            playerNum: options.playerNum ?? player.playerNum,
            groupNum: player.groupNum,
            hcpAllowance: player.hcpAllowance,
            hcpBefore: player.hcpBefore,
            hcpRound: player.hcpRound,
            playerID: player.playerID,
            // Theirs for an accepted friend, ours otherwise.
            playerUserID: player.playerUserID,
            gender: player.gender,
        };
        if (options.withCard) {
            // Always eighteen slots indexed by course hole, padded with -1: the
            // invariant every captured card holds to.
            row.strokes = fullCard(this.cards.get(player.sid), this.holes);
        }
        return row;
    }

    private slotFor(player: PlayerRef): RoundPlayerSlot {
        const sid = this.sidFor(player);
        return this.players.find((slot) => slot.sid === sid)!;
    }

    private envelope(): Record<string, unknown> {
        const d = this.descriptor;
        return {
            roundID: d.roundID,
            courseID: d.courseID,
            nine1: d.nine1,
            nine2: d.nine2,
            courseChanged: 0,
            date: d.date,
            hcpRoundSubmitted: 0,
            numGroups: d.numGroups,
            numPlayers: this.players.length,
            markerName: d.markerName,
            noNotifications: d.noNotifications ? 1 : 0,
            competitionName: d.competitionName,
            showAdjustedScore: 0,
            gameFormat: d.gameFormat,
        };
    }

    /** Where a course hole sits on this round's card, 0-based. */
    private positionOf(hole: number): number {
        const position = this.holes.indexOf(hole);
        if (position === -1) {
            const holes = this.holes;
            throw new MScorecardError(
                `Hole ${hole} is not in this round, which plays holes ${holes[0]}-${holes[holes.length - 1]}. ` +
                    `Score by course hole number, not by position on the card.`,
            );
        }
        return position;
    }

    /**
     * Catches a write the server accepted and then ignored.
     *
     * `noEdit: 1` comes back with a 200 and a fresh version token, so nothing else
     * about the response says the scores went nowhere.
     */
    private assertWasEdited(body: Record<string, unknown>): void {
        if (body.noEdit) {
            this.editable = false;
            throw new MScorecardNotEditableError(
                `Round ${this.roundID} is locked against edits, so the scores were not saved. ` +
                    `A round already processed for handicap purposes cannot be changed.`,
            );
        }
    }

    private acceptTs(body: Record<string, unknown>): void {
        const ts = body.ts;
        if (typeof ts !== "string" || ts === "") {
            throw new MScorecardConflictError(
                `Round ${this.roundID} was written but the server returned no new version token, ` +
                    `so this client can no longer write to it. Re-open the round to recover.`,
            );
        }
        this.version = ts;
    }

    /**
     * Runs writes one at a time, so the `ts` chain stays intact under concurrency.
     *
     * Pass `allowFinished` for the operations a completed round still accepts —
     * submitting it for handicap calculation. Scoring is not one of them.
     */
    private write<T>(operation: () => Promise<T>, options: { allowFinished?: boolean } = {}): Promise<T> {
        if (this.deleted) {
            return Promise.reject(new MScorecardError(`Round ${this.roundID} has been deleted.`));
        }
        if (this.finished && !options.allowFinished) {
            return Promise.reject(
                new MScorecardError(`Round ${this.roundID} is already finished, so scores can no longer be written.`),
            );
        }
        const result = this.pending.then(operation, operation);
        // Keep the queue alive even if this operation rejects.
        this.pending = result.catch(() => undefined);
        return result;
    }
}

/**
 * A card as the API represents one: eighteen slots indexed by **course hole**, with
 * `-1` where nothing was played.
 *
 * Our own card is indexed by position, so a back-nine round's first score moves from
 * index 0 to index 9 on the way out. The two coincide only on a round starting at
 * the first hole, which is why this is easy to miss.
 */
function fullCard(card: readonly number[] | undefined, holes: readonly number[]): number[] {
    const byCourseHole = new Array<number>(MAX_HOLES).fill(NOT_ENTERED);
    holes.forEach((hole, position) => {
        const value = card?.[position];
        if (value !== undefined && hole >= 1 && hole <= MAX_HOLES) byCourseHole[hole - 1] = value;
    });
    return byCourseHole;
}

/** Builds the descriptor a round needs to re-send its envelope on later PUTs. */
export function describeRound(input: {
    roundID: string;
    courseID: string;
    nine1: NineSelection;
    nine2: NineSelection;
    date?: Date;
    gameFormat?: GameFormat;
    competitionName?: string;
    markerName?: string;
    numGroups?: number;
    noNotifications?: boolean;
}): RoundDescriptor {
    return {
        roundID: input.roundID,
        courseID: input.courseID,
        nine1: input.nine1,
        nine2: input.nine2,
        date: formatRoundDate(input.date ?? new Date()),
        gameFormat: input.gameFormat ?? STABLEFORD,
        competitionName: input.competitionName ?? "",
        markerName: input.markerName ?? "",
        numGroups: input.numGroups ?? 1,
        noNotifications: input.noNotifications ?? true,
    };
}
