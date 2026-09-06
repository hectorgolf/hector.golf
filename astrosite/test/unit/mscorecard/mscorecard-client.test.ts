import { expect, describe, it, beforeEach } from "vitest";

import { MScorecardClient } from "../../../src/code/mscorecard/index.ts";
import { MScorecardAuthError, MScorecardError } from "../../../src/code/mscorecard/errors.ts";
import type { FetchLike } from "../../../src/code/mscorecard/http.ts";

type RecordedCall = {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
};

/** A fetch() stand-in that replays queued responses and records what it was asked. */
class FakeFetch {
    readonly calls: RecordedCall[] = [];
    private readonly queue: Array<{ status: number; body: unknown }> = [];

    respondWith(body: unknown, status = 200): this {
        this.queue.push({ status, body });
        return this;
    }

    get fetch(): FetchLike {
        return async (url, init) => {
            const method = init?.method ?? "GET";
            const rawBody = init?.body as string | undefined;
            this.calls.push({
                url,
                method,
                headers: (init?.headers ?? {}) as Record<string, string>,
                body: parseBody(rawBody, method, url),
            });
            const next = this.queue.shift();
            if (!next) throw new Error(`FakeFetch has no queued response for ${method} ${url}`);
            return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
                status: next.status,
                headers: { "Content-Type": "application/json" },
            });
        };
    }

    /** The single call made to a path, failing the test if there was not exactly one. */
    call(index: number): RecordedCall {
        const call = this.calls[index];
        if (!call) throw new Error(`No call at index ${index}; there were ${this.calls.length}.`);
        return call;
    }
}

function parseBody(raw: string | undefined, method: string, url: string): any {
    if (raw === undefined) return undefined;
    if (url.endsWith(".php")) return Object.fromEntries(new URLSearchParams(raw));
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Body of ${method} ${url} was not JSON: ${raw}`);
    }
}

const LOGIN_RESPONSE = {
    email: "user.name@gmail.com",
    userID: "694833",
    token: "PASSWORD_TOKEN_GOES_HERE",
    accessToken: "TOKEN_FROM_LOGIN",
};

/** Mirrors the shape of a real round-creation response, trimmed to what we read. */
function roundCreated(ts: string) {
    return {
        ts,
        round: {
            roundID: "1788647732160",
            userID: "694833",
            joinCode: "5vzi3dfy",
            scores: [
                {
                    sid: "28456998",
                    oldSid: -1,
                    name: "Ulf User",
                    shortName: "LK",
                    hcp: 17,
                    hcpBefore: 14.8,
                    allowance: 100,
                    teeID: "208146",
                    gender: "1",
                    hcpRound: 1,
                    playerNum: 1,
                    groupNum: 1,
                    playerID: "1618037712778955",
                    st: new Array(18).fill(-1),
                },
                {
                    sid: "28456999",
                    oldSid: -2,
                    name: "Tony Tester",
                    shortName: "TM",
                    hcp: 36,
                    hcpBefore: 36,
                    allowance: 100,
                    teeID: "208146",
                    gender: "1",
                    hcpRound: 0,
                    playerNum: 2,
                    groupNum: 1,
                    playerID: "1788645892735896",
                    st: new Array(18).fill(-1),
                },
                {
                    sid: "28457000",
                    oldSid: -3,
                    name: "Lotta",
                    shortName: "LO",
                    hcp: 54,
                    hcpBefore: 54,
                    allowance: 100,
                    teeID: "208149",
                    gender: "0",
                    hcpRound: 0,
                    playerNum: 3,
                    groupNum: 1,
                    playerID: "1619952902663",
                    st: new Array(18).fill(-1),
                },
            ],
        },
    };
}

const THREE_PLAYERS = [
    {
        playerID: "1618037712778955",
        teeID: "208146",
        extTeeID: 5,
        courseHcp: 17,
        hcpBefore: 14.8,
        gender: "1" as const,
        hcpRound: 1 as const,
    },
    { playerID: "1788645892735896", teeID: "208146", extTeeID: 5, courseHcp: 36, hcpBefore: 36, gender: "1" as const },
    { playerID: "1619952902663", teeID: "208149", extTeeID: 2, courseHcp: 54, hcpBefore: 54, gender: "0" as const },
];

async function loggedInClient(http: FakeFetch): Promise<MScorecardClient> {
    http.respondWith(LOGIN_RESPONSE);
    const client = new MScorecardClient({ fetch: http.fetch });
    await client.login("user.name@gmail.com", "hunter2");
    return client;
}

describe("mScorecard SDK", () => {
    let http: FakeFetch;

    beforeEach(() => {
        http = new FakeFetch();
    });

    describe("authentication", () => {
        it("keeps both credentials from the login response", async () => {
            const client = await loggedInClient(http);

            expect(client.session.accessToken).toEqual("TOKEN_FROM_LOGIN");
            expect(client.session.legacyToken).toEqual(LOGIN_RESPONSE.token);
            expect(client.userID).toEqual("694833");
        });

        it("reports a rejected login rather than continuing unauthenticated", async () => {
            http.respondWith({ msg: "Wrong password", accessToken: "" });
            const client = new MScorecardClient({ fetch: http.fetch });

            await expect(client.login("user.name@gmail.com", "wrong")).rejects.toThrow(MScorecardAuthError);
        });

        it("sends the hashed token to legacy endpoints, never the password", async () => {
            const client = await loggedInClient(http);
            http.respondWith([]);

            await client.searchPlayers("Tony Tester");

            expect(http.call(1).body.password).toEqual(LOGIN_RESPONSE.token);
            expect(http.call(1).body.password).not.toEqual("hunter2");
            expect(http.call(1).body.searchString).toEqual("Tony Tester");
        });

        it("refuses to call the API before logging in", async () => {
            const client = new MScorecardClient({ fetch: http.fetch });

            await expect(client.getCourse("0121568050825406011")).rejects.toThrow(MScorecardAuthError);
        });

        it("turns a 401 into an auth error that names token rotation", async () => {
            const client = await loggedInClient(http);
            http.respondWith({ msg: "expired" }, 401);

            await expect(client.getCourse("0121568050825406011")).rejects.toThrow(/rotate/i);
        });
    });

    describe("access token rotation", () => {
        it("authenticates the next request with the token the previous response returned", async () => {
            const client = await loggedInClient(http);
            http.respondWith({ ...roundCreated("100"), accessToken: "ROTATED_ONCE" });
            http.respondWith({ ts: "200", accessToken: "ROTATED_TWICE" });
            http.respondWith({ ts: "300" });

            const round = await client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
            await round.scoreHole(1, { "Ulf User": 5 });
            await round.scoreHole(2, { "Ulf User": 4 });

            expect(http.call(1).headers.Authorization).toEqual("Bearer TOKEN_FROM_LOGIN");
            expect(http.call(2).headers.Authorization).toEqual("Bearer ROTATED_ONCE");
            expect(http.call(3).headers.Authorization).toEqual("Bearer ROTATED_TWICE");
            expect(client.session.accessToken).toEqual("ROTATED_TWICE");
        });

        it("notifies the caller so a stored session can be kept fresh", async () => {
            const rotations: string[] = [];
            http.respondWith(LOGIN_RESPONSE).respondWith({ course: { courseID: "C" }, accessToken: "ROTATED" });
            const client = new MScorecardClient({ fetch: http.fetch, onTokenRotated: (t) => rotations.push(t) });

            await client.login("user.name@gmail.com", "hunter2");
            await client.getCourse("C");

            expect(rotations).toEqual(["ROTATED"]);
        });
    });

    describe("creating a round", () => {
        it("sends negative placeholder IDs, since the sids do not exist yet", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("1788647779543309"));

            await client.createRound({ courseID: "0121568050825406011", nine1: 1, nine2: 0, players: THREE_PLAYERS });

            const sent = http.call(1).body.round;
            expect(sent.scores.map((s: any) => s.ID)).toEqual([-1, -2, -3]);
            expect(sent.scores.map((s: any) => s.playerID)).toEqual(THREE_PLAYERS.map((p) => p.playerID));
            expect(sent.numPlayers).toEqual(3);
            // A brand new round is announced with ts 0.
            expect(http.call(1).body.ts).toEqual(0);
        });

        it("maps each player to the sid the server minted for them", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("1788647779543309"));

            const round = await client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });

            expect(round.players.map((p) => [p.name, p.sid])).toEqual([
                ["Ulf User", "28456998"],
                ["Tony Tester", "28456999"],
                ["Lotta", "28457000"],
            ]);
            expect(round.ts).toEqual("1788647779543309");
        });

        it("fails loudly when the server drops a player it could not resolve", async () => {
            const client = await loggedInClient(http);
            const partial = roundCreated("1");
            partial.round.scores = partial.round.scores.slice(0, 2); // Lotta silently missing
            http.respondWith(partial);

            await expect(
                client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS }),
            ).rejects.toThrow(/1619952902663.*roster/s);
        });

        it("rejects a round with no players", async () => {
            const client = await loggedInClient(http);

            await expect(client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: [] })).rejects.toThrow(
                MScorecardError,
            );
        });
    });

    describe("scoring", () => {
        const createRound = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_AFTER_CREATE"));
            return client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
        };

        it("resolves players by name, playerID or sid", async () => {
            const round = await createRound();

            expect(round.sidFor("Tony Tester")).toEqual("28456999");
            expect(round.sidFor("1788645892735896")).toEqual("28456999");
            expect(round.sidFor("28456999")).toEqual("28456999");
            expect(round.sidFor(round.players[1]!)).toEqual("28456999");
        });

        it("explains itself when asked for a player who is not in the round", async () => {
            const round = await createRound();

            expect(() => round.sidFor("Tiger Woods")).toThrow(/No player "Tiger Woods".* Ulf User/s);
        });

        it("writes a whole hole in one request, keyed by sid", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_HOLE_1" });

            await round.scoreHole(1, { "Ulf User": 5, "Tony Tester": 4, Lotta: 7 });

            expect(http.call(2).method).toEqual("PATCH");
            expect(http.call(2).body.scores).toEqual([
                { sid: "28456998", h: 1, st: 5 },
                { sid: "28456999", h: 1, st: 4 },
                { sid: "28457000", h: 1, st: 7 },
            ]);
        });

        it("echoes the ts from the previous response on every write", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_HOLE_1" }).respondWith({ ts: "TS_AFTER_HOLE_2" });

            await round.scoreHole(1, { "Ulf User": 5 });
            await round.scoreHole(2, { "Ulf User": 4 });

            expect(http.call(2).body.ts).toEqual("TS_AFTER_CREATE");
            expect(http.call(3).body.ts).toEqual("TS_AFTER_HOLE_1");
            expect(round.ts).toEqual("TS_AFTER_HOLE_2");
        });

        it("serialises overlapping writes so neither reuses a stale ts", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_HOLE_1" }).respondWith({ ts: "TS_AFTER_HOLE_2" });

            await Promise.all([round.scoreHole(1, { "Ulf User": 5 }), round.scoreHole(2, { "Ulf User": 4 })]);

            expect(http.call(2).body.ts).toEqual("TS_AFTER_CREATE");
            expect(http.call(3).body.ts).toEqual("TS_AFTER_HOLE_1");
        });

        it("tracks each player's card as scores are written", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_HOLE_1" });

            await round.scoreHole(1, { "Tony Tester": 4 });

            expect(round.card("Tony Tester")[0]).toEqual(4);
            expect(round.card("Tony Tester")[1]).toEqual(-1);
            expect(round.card("Ulf User")[0]).toEqual(-1);
        });

        it("writes a player's whole card, skipping holes that were not played", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_CARD" });

            await round.scorePlayer("Lotta", [6, 4, undefined, 5]);

            expect(http.call(2).body.scores).toEqual([
                { sid: "28457000", h: 1, st: 6 },
                { sid: "28457000", h: 2, st: 4 },
                { sid: "28457000", h: 4, st: 5 },
            ]);
        });

        it("rejects a hole outside a nine-hole round before hitting the network", async () => {
            const round = await createRound(); // nine1 1, nine2 0 — holes 1-9

            expect(round.numHoles).toEqual(9);
            expect(round.holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
            await expect(round.scoreHole(10, { "Ulf User": 4 })).rejects.toThrow(/not in this round/);
            expect(http.calls).toHaveLength(2); // login + create only
        });

        it("refuses to score a round that has been finished", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" });
            await round.finish();

            expect(round.isFinished).toBe(true);
            await expect(round.scoreHole(1, { "Ulf User": 4 })).rejects.toThrow(/already finished/);
        });
    });

    describe("finishing and submitting", () => {
        const createRound = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_AFTER_CREATE"));
            return client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
        };

        it("submits a round that was finished first", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" }).respondWith({ ts: "TS_AFTER_SUBMIT" });

            await round.finish();
            await round.submitForHandicap("Marker McMarkerface");

            expect(http.call(2).body.round.finished).toEqual(1);
            expect(http.call(2).body.submitHcpRound).toEqual(0);
            expect(http.call(3).body.submitHcpRound).toEqual(1);
            expect(http.call(3).body.round.markerName).toEqual("Marker McMarkerface");
            // The submit still has to echo the ts the finish handed back.
            expect(http.call(3).body.ts).toEqual("TS_AFTER_FINISH");
            expect(round.isSubmitted).toBe(true);
        });

        it("treats a second finish as a no-op rather than an error", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" });

            await round.finish();
            await round.finish();

            expect(http.calls).toHaveLength(3); // login, create, one finish
            expect(round.isFinished).toBe(true);
        });

        it("does not forward a round to the golf association twice", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_SUBMIT" });

            await round.submitForHandicap();
            await round.submitForHandicap();

            expect(http.calls).toHaveLength(3); // login, create, one submit
        });

        it("stays idempotent when the calls overlap", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" });

            await Promise.all([round.finish(), round.finish(), round.finish()]);

            expect(http.calls).toHaveLength(3);
        });

        it("submits after a finish that is still in flight", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" }).respondWith({ ts: "TS_AFTER_SUBMIT" });

            await Promise.all([round.finish(), round.submitForHandicap()]);

            expect(http.call(2).body.submitHcpRound).toEqual(0);
            expect(http.call(3).body.submitHcpRound).toEqual(1);
            expect(http.call(3).body.ts).toEqual("TS_AFTER_FINISH");
        });

        it("still refuses to score a finished round", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_FINISH" });
            await round.finish();

            await expect(round.scoreHole(1, { "Ulf User": 4 })).rejects.toThrow(
                /already finished, so scores can no longer be written/,
            );
        });

        it("refuses to submit a deleted round", async () => {
            const round = await createRound();
            http.respondWith([]);
            await round.delete();

            await expect(round.submitForHandicap()).rejects.toThrow(/has been deleted/);
        });

        it("sends a full eighteen-slot card even for a nine-hole round", async () => {
            const round = await createRound();
            http.respondWith({ ts: "TS_AFTER_SCORES" }).respondWith({ ts: "TS_AFTER_SUBMIT" });

            await round.scorePlayer("Ulf User", [5, 4, 6, 4, 3, 5, 4, 5, 6]);
            await round.submitForHandicap();

            const submitted = http.call(3).body.round.scores;
            expect(submitted[0].ID).toEqual("28456998");
            // Every captured card is eighteen long whatever the round's length; a
            // nine-hole round fills 1-9 and leaves the rest at -1. Truncating to nine
            // is what made a submitted round come back with no scores at all.
            expect(submitted[0].strokes).toEqual([5, 4, 6, 4, 3, 5, 4, 5, 6, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
            expect(submitted[0].strokes).toHaveLength(18);
        });
    });

    describe("re-opening a round", () => {
        /**
         * A real GET response, trimmed, from a verified-correct back-nine round.
         *
         * Two things to notice. It agrees with the round-creation response on almost
         * nothing: the row is `ID` not `sid`, the card is `strokes` not `st`, and the
         * name lives on a nested `player`. And the card is indexed by **course
         * hole**, so this nine-hole round on nine 2 fills indices 9-17, not 0-8.
         */
        const GET_RESPONSE = {
            ts: "1788727493734756",
            round: {
                roundID: "1788727140517",
                userID: "694833",
                courseID: "0121396100764289",
                nine1: 2,
                nine2: 0,
                date: "202609062339",
                finished: "0",
                hcpRoundSubmitted: "0",
                gameFormat: "0",
                markerName: "Esa Kemppinen",
                numGroups: 1,
                numPlayers: 1,
                scores: [
                    {
                        ID: "28466883",
                        roundID: "1788727140517",
                        playerNum: 1,
                        groupNum: 1,
                        playerID: "1618037712778955",
                        courseHcp: 15,
                        teeID: "207397",
                        strokes: [-1, -1, -1, -1, -1, -1, -1, -1, -1, 6, 7, 4, 4, 7, 6, 6, 5, 5],
                        player: { name: "Lasse Koskela", shortName: "LK", playerID: "1618037712778955" },
                    },
                ],
            },
        };

        it("reads the sid, name and card out of the GET shape", async () => {
            const client = await loggedInClient(http);
            http.respondWith(GET_RESPONSE);

            const round = await client.openRound("1788727140517");

            expect(round.players[0]).toMatchObject({
                sid: "28466883",
                name: "Lasse Koskela",
                shortName: "LK",
                courseHcp: 15,
            });
            expect(round.card("Lasse Koskela").slice(0, 9)).toEqual([6, 7, 4, 4, 7, 6, 6, 5, 5]);
            expect(round.ts).toEqual("1788727493734756");
        });

        it("recovers the nine configuration, so hole numbering stays right", async () => {
            const client = await loggedInClient(http);
            http.respondWith(GET_RESPONSE);

            const round = await client.openRound("1788727140517");

            expect(round.numHoles).toEqual(9);
            expect(round.descriptor.nine1).toEqual(2);
            expect(round.descriptor.nine2).toEqual(0);
            // The server's own date, not "now".
            expect(round.descriptor.date).toEqual("202609062339");
        });

        it("knows the state the server already holds", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ...GET_RESPONSE,
                round: { ...GET_RESPONSE.round, finished: "1", hcpRoundSubmitted: "2" },
            });

            const round = await client.openRound("1788727140517");

            // A round read back does not start life as though it were brand new.
            expect(round.isFinished).toBe(true);
            expect(round.isSubmitted).toBe(true);
            await expect(round.scoreHole(12, { "Lasse Koskela": 5 })).rejects.toThrow(/already finished/);
        });

        it("can carry on scoring a re-opened round", async () => {
            const client = await loggedInClient(http);
            http.respondWith(GET_RESPONSE).respondWith({ ts: "TS_AFTER_FIX" });

            const round = await client.openRound("1788727140517");
            await round.scoreHole(12, { "Lasse Koskela": 5 });

            expect(http.call(2).body.ts).toEqual("1788727493734756");
            expect(http.call(2).body.scores).toEqual([{ sid: "28466883", h: 12, st: 5 }]);
        });
    });

    describe("which hole number goes on the wire", () => {
        const backNine = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            return client.createRound({ courseID: "C", nine1: 2, nine2: 0, players: [THREE_PLAYERS[0]!] });
        };

        it("numbers a back-nine round's holes 10 to 18", async () => {
            const round = await backNine();

            expect(round.holes).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
            expect(round.numHoles).toEqual(9);
        });

        it("sends the course hole number, which is what the app sends", async () => {
            const round = await backNine();
            http.respondWith({ ts: "TS_1" });

            await round.scorePlayer("Ulf User", [6, 7, 4, 4, 7, 6, 6, 5, 5]);

            // Byte for byte the payload the official app sends for this round.
            // Sending h: 1..9 instead is accepted and then shows no scores at all —
            // the app's rounds list reports such a round with "TotalStrokes": "-".
            expect(http.call(2).body.scores).toEqual([
                { sid: "28456998", h: 10, st: 6 },
                { sid: "28456998", h: 11, st: 7 },
                { sid: "28456998", h: 12, st: 4 },
                { sid: "28456998", h: 13, st: 4 },
                { sid: "28456998", h: 14, st: 7 },
                { sid: "28456998", h: 15, st: 6 },
                { sid: "28456998", h: 16, st: 6 },
                { sid: "28456998", h: 17, st: 5 },
                { sid: "28456998", h: 18, st: 5 },
            ]);
        });

        it("still keeps the card itself indexed by position", async () => {
            const round = await backNine();
            http.respondWith({ ts: "TS_1" });

            await round.scoreHole(11, { "Ulf User": 7 });

            // Hole 11 is the second hole of the card, and that is where the
            // eighteen-slot array the API reads back holds it.
            expect(round.card("Ulf User")[1]).toEqual(7);
            expect(round.card("Ulf User")[10]).toEqual(-1);
        });

        it("refuses a card position mistaken for a hole number", async () => {
            const round = await backNine();

            await expect(round.scoreHole(1, { "Ulf User": 6 })).rejects.toThrow(
                /Hole 1 is not in this round, which plays holes 10-18/,
            );
            expect(http.calls).toHaveLength(2); // nothing was sent
        });

        it("numbers an eighteen-hole round 1 to 18", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 2,
                players: [THREE_PLAYERS[0]!],
            });

            expect(round.holes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
        });

        it("numbers a crossover start 10 to 18 then 1 to 9", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 1,
                players: [THREE_PLAYERS[0]!],
            });

            expect(round.holes.slice(0, 9)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
            expect(round.holes.slice(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        });
    });

    describe("the card is indexed by course hole on the wire", () => {
        const BACK_NINE_CARD = [6, 7, 4, 4, 7, 6, 6, 5, 5];

        it("reads a back-nine card out of indices 9 to 17", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ts: "TS",
                round: {
                    roundID: "R",
                    nine1: 2,
                    nine2: 0,
                    scores: [
                        {
                            ID: "S",
                            playerID: "P",
                            strokes: [-1, -1, -1, -1, -1, -1, -1, -1, -1, ...BACK_NINE_CARD],
                            player: { name: "Ulf User" },
                        },
                    ],
                },
            });

            const round = await client.openRound("R");

            // Our card is by position, so hole 10 lands at index 0.
            expect(round.card("S").slice(0, 9)).toEqual(BACK_NINE_CARD);
        });

        it("writes a back-nine card into indices 9 to 17 when submitting", async () => {
            const client = await loggedInClient(http);
            const created = roundCreated("TS_0");
            created.round.scores[0]!.hcpRound = 1;
            http.respondWith(created);
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [{ ...THREE_PLAYERS[0]!, hcpRound: 1 }],
            });
            http.respondWith({ ts: "TS_1" }).respondWith({ ts: "TS_2" });

            await round.scorePlayer("Ulf User", BACK_NINE_CARD);
            await round.submitForHandicap("Marker");

            expect(http.call(3).body.round.scores[0].strokes).toEqual([
                -1, -1, -1, -1, -1, -1, -1, -1, -1, ...BACK_NINE_CARD,
            ]);
        });

        it("leaves an eighteen-hole card alone, where hole and position agree", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ts: "TS",
                round: {
                    roundID: "R",
                    nine1: 1,
                    nine2: 2,
                    scores: [{ ID: "S", playerID: "P", strokes: new Array(18).fill(4), player: { name: "Ulf User" } }],
                },
            });

            const round = await client.openRound("R");

            expect(round.card("S")).toEqual(new Array(18).fill(4));
        });

        it("survives a round trip through both conversions", async () => {
            const client = await loggedInClient(http);
            const created = roundCreated("TS_0");
            http.respondWith(created);
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });
            http.respondWith({ ts: "TS_1" });
            await round.scorePlayer("Ulf User", BACK_NINE_CARD);

            // Feed what we wrote back in the shape the server would return it.
            const onTheWire = new Array(18).fill(-1);
            http.call(2).body.scores.forEach((score: any) => (onTheWire[score.h - 1] = score.st));
            http.respondWith({
                ts: "TS_2",
                round: {
                    roundID: round.roundID,
                    nine1: 2,
                    nine2: 0,
                    scores: [{ ID: "28456998", playerID: "P", strokes: onTheWire, player: { name: "Ulf User" } }],
                },
            });
            const reopened = await client.openRound(round.roundID);

            expect(onTheWire.slice(9)).toEqual(BACK_NINE_CARD); // written by course hole
            expect(reopened.card("28456998").slice(0, 9)).toEqual(BACK_NINE_CARD); // read by position
        });
    });

    describe("changing when a round was played", () => {
        const openRoundOf = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            return client.createRound({
                courseID: "0121247300657988",
                nine1: 1,
                nine2: 2,
                date: new Date(2026, 8, 7, 2, 0),
                players: [THREE_PLAYERS[0]!],
            });
        };

        it("names the change in modifiedFields and sends no scores", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_1" });

            await round.setDate(new Date(2026, 8, 6, 17, 10));

            const sent = http.call(2).body.round;
            // The one place any capture puts something in modifiedFields.
            expect(sent.modifiedFields).toEqual([{ date: "202609061710" }]);
            expect(sent.date).toEqual("202609061710");
            expect(sent.scores).toEqual([]);
            expect(sent.scoresDeleted).toEqual([]);
        });

        it("writes the wall clock, not UTC", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_1" });

            await round.setDate(new Date(2026, 8, 6, 17, 10));

            // 17:10 stays 17:10 whatever the machine's offset.
            expect(http.call(2).body.round.date.slice(-4)).toEqual("1710");
        });

        it("remembers the new date, so a later write does not undo it", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_1" }).respondWith({ ts: "TS_2" });

            await round.setDate(new Date(2026, 8, 6, 17, 10));
            await round.finish();

            expect(round.descriptor.date).toEqual("202609061710");
            expect(http.call(3).body.round.date).toEqual("202609061710");
        });

        it("says nothing to the server when the date is already right", async () => {
            const round = await openRoundOf();

            await round.setDate(new Date(2026, 8, 7, 2, 0));

            expect(http.calls).toHaveLength(2); // login and create only
        });

        it("refuses to move a round the federation already has", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ts: "TS",
                round: {
                    roundID: "R",
                    nine1: 1,
                    nine2: 2,
                    date: "202609070200",
                    finished: "1",
                    hcpRoundSubmitted: "1",
                    scores: [{ ID: "S", playerID: "P", strokes: new Array(18).fill(-1), player: { name: "Ulf" } }],
                },
            });
            const submitted = await client.openRound("R");

            await expect(submitted.setDate(new Date(2026, 8, 6, 17, 10))).rejects.toThrow(/cannot be changed/);
        });
    });

    describe("the format a new round gets", () => {
        it("is Stableford unless asked for otherwise", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));

            await client.createRound({ courseID: "C", nine1: 1, nine2: 2, players: [THREE_PLAYERS[0]!] });

            expect(http.call(1).body.round.gameFormat).toEqual(2);
        });

        it("still honours an explicit format", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));

            await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 2,
                gameFormat: 0,
                players: [THREE_PLAYERS[0]!],
            });

            expect(http.call(1).body.round.gameFormat).toEqual(0);
        });

        it("reports what a round read back actually is, not the default", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ts: "TS",
                round: {
                    roundID: "R",
                    nine1: 1,
                    nine2: 2,
                    // A Stroke Play round created elsewhere, and a string at that.
                    gameFormat: "0",
                    scores: [{ ID: "S", playerID: "P", strokes: new Array(18).fill(-1), player: { name: "Ulf" } }],
                },
            });

            const round = await client.openRound("R");

            expect(round.descriptor.gameFormat).toEqual(0);
        });
    });

    describe("changing how a round is scored", () => {
        const openRoundOf = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            return client.createRound({
                courseID: "0121247300657988",
                nine1: 1,
                nine2: 2,
                gameFormat: 0,
                players: [THREE_PLAYERS[0]!],
            });
        };

        it("sends the new format with no scores and an empty modifiedFields", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_1" });

            await round.setGameFormat(2);

            const sent = http.call(2).body.round;
            expect(sent.gameFormat).toEqual(2);
            expect(sent.scores).toEqual([]);
            // Unlike the date, this names nothing: modifiedFields is not a general
            // record of what changed.
            expect(sent.modifiedFields).toEqual([]);
            expect(sent.courseChanged).toEqual(0);
        });

        it("remembers the format for later writes", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_1" }).respondWith({ ts: "TS_2" });

            await round.setGameFormat(1);
            await round.finish();

            expect(round.descriptor.gameFormat).toEqual(1);
            expect(http.call(3).body.round.gameFormat).toEqual(1);
        });

        it("says nothing to the server when the format is already right", async () => {
            const round = await openRoundOf();

            await round.setGameFormat(0);

            expect(http.calls).toHaveLength(2);
        });

        it("leaves the scores alone", async () => {
            const round = await openRoundOf();
            http.respondWith({ ts: "TS_SCORED" });
            await round.scoreHole(1, { "Ulf User": 5 });
            http.respondWith({ ts: "TS_1" });

            await round.setGameFormat(2);

            // How a card is totalled is not what is on it.
            expect(round.card("Ulf User")[0]).toEqual(5);
        });
    });

    describe("putting a player on the card", () => {
        /** The reply the app gets: the new row only, with oldSid naming the placeholder. */
        const addedLuka = {
            ts: "1788738729618916",
            round: {
                roundID: "1788737212480",
                numPlayers: "3",
                scores: [
                    {
                        sid: "28467211",
                        oldSid: -1,
                        name: "Luka",
                        shortName: "LU",
                        gender: "1",
                        hcp: 50,
                        hcpBefore: 54,
                        allowance: 100,
                        teeID: "176354",
                        hcpRound: 0,
                        groupNum: 1,
                        playerNum: 3,
                        playerID: "1619952956183",
                        playerUserID: "694833",
                        st: new Array(18).fill(-1),
                    },
                ],
            },
        };

        const twoPlayerRound = async () => {
            const client = await loggedInClient(http);
            const created = roundCreated("TS_0");
            created.round.scores = created.round.scores.slice(0, 2);
            http.respondWith(created);
            const round = await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 2,
                players: THREE_PLAYERS.slice(0, 2),
            });
            return { client, round };
        };

        const luka = {
            playerID: "1619952956183",
            teeID: "176354",
            extTeeID: 2,
            courseHcp: 50,
            hcpBefore: 54,
            gender: "1" as const,
        };

        it("sends only the new row, not the players already on the card", async () => {
            const { client, round } = await twoPlayerRound();
            http.respondWith(addedLuka);

            await client.addPlayerToRound(round, luka);

            const sent = http.call(2).body.round;
            // The opposite of a removal, which re-sends every survivor.
            expect(sent.scores).toHaveLength(1);
            expect(sent.scores[0]).toMatchObject({
                ID: -1,
                modified: 1,
                playerNum: 3,
                courseHcp: 50,
                teeID: "176354",
                extTeeID: 2,
                hcpBefore: 54,
                playerID: "1619952956183",
            });
            expect(sent.scores[0].strokes).toBeUndefined();
            expect(sent.numPlayers).toEqual(3);
            expect(sent.scoresDeleted).toEqual([]);
        });

        it("echoes the current ts rather than starting a new round", async () => {
            const { client, round } = await twoPlayerRound();
            http.respondWith(addedLuka);

            await client.addPlayerToRound(round, luka);

            // ts: 0 would create a round, not add to one.
            expect(http.call(2).body.ts).toEqual("TS_0");
        });

        it("takes the sid straight out of the reply", async () => {
            const { client, round } = await twoPlayerRound();
            http.respondWith(addedLuka);

            const added = await client.addPlayerToRound(round, luka);

            expect(added).toMatchObject({ sid: "28467211", name: "Luka", playerNum: 3, courseHcp: 50 });
            // No second request: the reply carries what we need.
            expect(http.calls).toHaveLength(3);
        });

        it("puts the new player on the round, ready to be scored", async () => {
            const { client, round } = await twoPlayerRound();
            http.respondWith(addedLuka);

            await client.addPlayerToRound(round, luka);

            expect(round.players.map((p) => p.name)).toEqual(["Ulf User", "Tony Tester", "Luka"]);
            expect(round.ts).toEqual("1788738729618916");
            expect(round.card("Luka").every((value) => value === -1)).toBe(true);

            http.respondWith({ ts: "TS_SCORED" });
            await round.scoreHole(1, { Luka: 6 });
            expect(http.call(3).body.scores).toEqual([{ sid: "28467211", h: 1, st: 6 }]);
        });

        it("refuses a reply that does not contain the player", async () => {
            const { client, round } = await twoPlayerRound();
            http.respondWith({ ts: "TS_1", round: { scores: [] } });

            await expect(client.addPlayerToRound(round, luka)).rejects.toThrow(/accepted but changed nothing/);
        });
    });

    describe("taking a player off the card", () => {
        const threePlayerRound = async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            return client.createRound({ courseID: "C", nine1: 1, nine2: 2, players: THREE_PLAYERS });
        };

        it("names the row in scoresDeleted and re-sends the rest", async () => {
            const round = await threePlayerRound();
            http.respondWith({ ts: "TS_1" });

            await round.removePlayer("Ulf User");

            const sent = http.call(2).body.round;
            expect(sent.scoresDeleted).toEqual([{ ID: "28456998" }]);
            expect(sent.numPlayers).toEqual(2);
            expect(sent.scores.map((s: any) => s.ID)).toEqual(["28456999", "28457000"]);
        });

        it("closes the gap in playerNum rather than leaving a hole", async () => {
            const round = await threePlayerRound();
            http.respondWith({ ts: "TS_1" });

            await round.removePlayer("Ulf User"); // was playerNum 1 of 3

            expect(http.call(2).body.round.scores.map((s: any) => s.playerNum)).toEqual([1, 2]);
            expect(round.players.map((p) => p.playerNum)).toEqual([1, 2]);
        });

        it("sends the survivors without cards, since this is not about scores", async () => {
            const round = await threePlayerRound();
            http.respondWith({ ts: "TS_1" });

            await round.removePlayer("Ulf User");

            for (const row of http.call(2).body.round.scores) {
                expect(row.modified).toEqual(1);
                expect(row.strokes).toBeUndefined();
            }
        });

        it("forgets the player and their card locally", async () => {
            const round = await threePlayerRound();
            http.respondWith({ ts: "TS_SCORES" });
            await round.scoreHole(1, { "Ulf User": 5, "Tony Tester": 4 });
            http.respondWith({ ts: "TS_1" });

            await round.removePlayer("Ulf User");

            expect(round.players.map((p) => p.name)).toEqual(["Tony Tester", "Lotta"]);
            expect(() => round.sidFor("Ulf User")).toThrow(/No player "Ulf User"/);
            // The survivor's card is untouched.
            expect(round.card("Tony Tester")[0]).toEqual(4);
        });

        it("refuses to empty the round, which is a deletion in disguise", async () => {
            const client = await loggedInClient(http);
            const created = roundCreated("TS_0");
            created.round.scores = created.round.scores.slice(0, 1);
            http.respondWith(created);
            const round = await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 2,
                players: [THREE_PLAYERS[0]!],
            });

            await expect(round.removePlayer("Ulf User")).rejects.toThrow(/Delete the round instead/);
            expect(http.calls).toHaveLength(2); // nothing was sent
        });
    });

    describe("a round that is locked against edits", () => {
        it("treats a silently ignored write as a failure", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });
            // What the server really answers on a processed round: 200, a fresh ts,
            // and a flag saying it did nothing.
            http.respondWith({ ts: "TS_1", noEdit: 1 });

            await expect(round.scoreHole(10, { "Ulf User": 4 })).rejects.toThrow(/locked against edits/);
        });

        it("stops reporting itself as editable afterwards", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });
            expect(round.isEditable).toBe(true);
            http.respondWith({ ts: "TS_1", noEdit: 1 });

            await round.scoreHole(10, { "Ulf User": 4 }).catch(() => undefined);

            expect(round.isEditable).toBe(false);
        });

        it("is not editable once finished", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });
            http.respondWith({ ts: "TS_1" });

            await round.finish();

            expect(round.isEditable).toBe(false);
        });

        it("accepts an ordinary write, which carries no such flag", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });
            http.respondWith({ ts: "TS_1" });

            await expect(round.scoreHole(10, { "Ulf User": 4 })).resolves.toBeUndefined();
            expect(round.isEditable).toBe(true);
        });
    });

    describe("handicap rounds versus practice rounds", () => {
        /** The server echoes back the flag it stored, so the fixture must too. */
        const createRound = async (hcpRound: 0 | 1) => {
            const client = await loggedInClient(http);
            const created = roundCreated("TS_0");
            created.round.scores[0]!.hcpRound = hcpRound;
            http.respondWith(created);
            const round = await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 0,
                players: [{ ...THREE_PLAYERS[0]!, hcpRound }],
            });
            return round;
        };

        it("creates a practice round unless told otherwise", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));

            await client.createRound({
                courseID: "C",
                nine1: 1,
                nine2: 0,
                players: [{ ...THREE_PLAYERS[0]!, hcpRound: undefined }],
            });

            // An accidental round cannot end up in anyone's handicap record.
            expect(http.call(1).body.round.scores[0].hcpRound).toEqual(0);
        });

        it("reads back which players are posting a handicap round", async () => {
            const round = await createRound(1);

            expect(round.countsTowardsHandicap("Ulf User")).toBe(true);
            expect(round.countsTowardsHandicap("Tony Tester")).toBe(false);
        });

        it("turns a practice round into a handicap round", async () => {
            const round = await createRound(0);
            http.respondWith({ ts: "TS_1" });

            await round.setCountsTowardsHandicap("Tony Tester", true);

            const sent = http.call(2).body;
            expect(sent.submitHcpRound).toEqual(0); // flips the flag, submits nothing
            expect(sent.round.finished).toEqual(0); // and does not finish the round
            // Exactly what the app sends: the one row that changed, marked modified,
            // and no card — attaching one would rewrite scores this is not about.
            expect(sent.round.scores).toHaveLength(1);
            expect(sent.round.scores[0]).toMatchObject({ ID: "28456999", modified: 1, hcpRound: 1 });
            expect(sent.round.scores[0].strokes).toBeUndefined();
            expect(round.countsTowardsHandicap("Tony Tester")).toBe(true);
        });

        it("turns a handicap round back into a practice round", async () => {
            const round = await createRound(1);
            http.respondWith({ ts: "TS_1" });

            await round.setCountsTowardsHandicap("Ulf User", false);

            expect(http.call(2).body.round.scores[0].hcpRound).toEqual(0);
            expect(round.countsTowardsHandicap("Ulf User")).toBe(false);
        });

        it("says nothing to the server when the flag is already right", async () => {
            const round = await createRound(1);

            await round.setCountsTowardsHandicap("Ulf User", true);

            expect(http.calls).toHaveLength(2); // login and create only
        });

        it("keeps the old flag if the server rejects the change", async () => {
            const round = await createRound(0);
            http.respondWith({ msg: "nope" }, 500);

            await expect(round.setCountsTowardsHandicap("Ulf User", true)).rejects.toThrow();

            expect(round.countsTowardsHandicap("Ulf User")).toBe(false);
        });

        it("can still be flagged after the round is finished", async () => {
            const round = await createRound(0);
            http.respondWith({ ts: "TS_FIN" }).respondWith({ ts: "TS_FLAG" });
            await round.finish();

            await round.setCountsTowardsHandicap("Ulf User", true);

            expect(round.countsTowardsHandicap("Ulf User")).toBe(true);
            // The round stays finished through the change.
            expect(http.call(3).body.round.finished).toEqual(1);
        });

        it("refuses to submit a round nobody is posting", async () => {
            const round = await createRound(0);

            await expect(round.submitForHandicap()).rejects.toThrow(/setCountsTowardsHandicap/);
            expect(http.calls).toHaveLength(2); // nothing was sent
        });

        it("sends the whole player row when submitting, not just the card", async () => {
            const round = await createRound(1);
            http.respondWith({ ts: "TS_SUB" });

            await round.submitForHandicap("Marker");

            const row = http.call(2).body.round.scores[0];
            // The field set the app itself sends; hcpRound decides whether the
            // round counts at all, and dropping it risks the server defaulting it.
            expect(row).toMatchObject({
                ID: "28456998",
                courseHcp: 17,
                teeID: "208146",
                extTeeID: 5,
                hcpAllowance: 100,
                hcpBefore: 14.8,
                hcpRound: 1,
                gender: "1",
                playerID: "1618037712778955",
            });
            expect(row.strokes).toHaveLength(18);
        });
    });

    describe("the self test's round trip", () => {
        /**
         * Mirrors what `--selftest` does against the live API: create, score in
         * scrambled batches, read back, delete. This is the sequence that would have
         * caught both the truncated-card and wrong-field-name bugs.
         */
        const CARD = [2, 3, 4, 5, 6, 7, 8, 9, 10];

        it("writes a scrambled card and reads it back in hole order", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_0"));
            const round = await client.createRound({
                courseID: "C",
                nine1: 2,
                nine2: 0,
                players: [THREE_PLAYERS[0]!],
            });

            const entries = CARD.map((strokes, index) => ({
                player: "Ulf User",
                hole: round.holes[index]!,
                strokes,
            }));
            const odd = entries.filter((_, index) => index % 2 === 0).reverse();
            const even = entries.filter((_, index) => index % 2 === 1);
            http.respondWith({ ts: "TS_1" }).respondWith({ ts: "TS_2" });

            await round.score(odd);
            await round.score(even);

            // Course hole numbers, in the order given; the server keys on sid.
            expect(http.call(2).body.scores.map((s: any) => s.h)).toEqual([18, 16, 14, 12, 10]);
            expect(http.call(3).body.scores.map((s: any) => s.h)).toEqual([11, 13, 15, 17]);
            // Each write echoes the previous response's token.
            expect(http.call(2).body.ts).toEqual("TS_0");
            expect(http.call(3).body.ts).toEqual("TS_1");
            // Locally tracked card is in hole order regardless of write order.
            expect(round.card("Ulf User").slice(0, 9)).toEqual(CARD);
        });

        it("verifies the eighteen-slot card the server returns", async () => {
            const client = await loggedInClient(http);
            http.respondWith({
                ts: "TS_READ",
                round: {
                    roundID: "R", nine1: 2, nine2: 0, date: "202609062339", numPlayers: 1,
                    scores: [{
                        ID: "28466883", playerID: "1618037712778955", courseHcp: 15, playerNum: 1, groupNum: 1,
                        // Course-hole indexed: nine 2 means holes 10-18, indices 9-17.
                        strokes: [-1, -1, -1, -1, -1, -1, -1, -1, -1, ...CARD],
                        player: { name: "Ulf User", shortName: "UU" },
                    }],
                },
            });

            const stored = await client.openRound("R");
            const card = stored.card("28466883");

            expect(card).toHaveLength(18);
            expect(card.slice(0, 9)).toEqual(CARD);
            expect(card.slice(9).every((value) => value === -1)).toBe(true);
            expect(stored.numHoles).toEqual(9);
        });
    });

    describe("deleting a round", () => {
        it("sends a bare DELETE with no ts and no body", async () => {
            const client = await loggedInClient(http);
            http.respondWith([]); // the server answers with an empty array

            await client.deleteRound("1788647732160");

            const call = http.call(1);
            expect(call.method).toEqual("DELETE");
            expect(call.url).toEqual("https://www.mscorecard.com/api/v2.3/rounds/1788647732160");
            expect(call.body).toBeUndefined();
            expect(call.headers.Authorization).toEqual("Bearer TOKEN_FROM_LOGIN");
        });

        it("tolerates the array response, which is not the usual object", async () => {
            const client = await loggedInClient(http);
            http.respondWith([]);

            await expect(client.deleteRound("1788647732160")).resolves.toBeUndefined();
        });

        it("deletes a round we hold a handle to, and stops accepting scores", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_AFTER_CREATE"));
            const round = await client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
            http.respondWith([]);

            await round.delete();

            expect(round.isDeleted).toBe(true);
            expect(http.call(2).method).toEqual("DELETE");
            await expect(round.scoreHole(1, { "Ulf User": 4 })).rejects.toThrow(/has been deleted/);
        });

        it("deletes a finished round, which no other write allows", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_AFTER_CREATE"));
            const round = await client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
            http.respondWith({ ts: "TS_AFTER_FINISH" }).respondWith([]);
            await round.finish();

            await expect(round.delete()).resolves.toBeUndefined();
            expect(round.isDeleted).toBe(true);
        });

        it("lets a score already in flight finish before deleting", async () => {
            const client = await loggedInClient(http);
            http.respondWith(roundCreated("TS_AFTER_CREATE"));
            const round = await client.createRound({ courseID: "C", nine1: 1, nine2: 0, players: THREE_PLAYERS });
            http.respondWith({ ts: "TS_AFTER_HOLE_1" }).respondWith([]);

            await Promise.all([round.scoreHole(1, { "Ulf User": 5 }), round.delete()]);

            expect(http.call(2).method).toEqual("PATCH");
            expect(http.call(3).method).toEqual("DELETE");
        });
    });

    describe("reading reference data", () => {
        it("normalises friend-search hits, keeping user ID and roster ID apart", async () => {
            const client = await loggedInClient(http);
            http.respondWith([
                {
                    FirstName: "Toni",
                    LastName: "Marttila",
                    Name: "Tony Tester",
                    ShortName: "TM",
                    Country: "Finland",
                    Club: "",
                    Hcp: 36,
                    Gender: 1,
                    Email: "",
                    ID: "207653",
                    PID: null,
                    FriendStatus: null,
                },
            ]);

            const [hit] = await client.searchPlayers("Tony Tester");

            expect(hit).toMatchObject({ name: "Tony Tester", hcp: 36, gender: "1", userID: "207653" });
            // Not yet in the roster, so there is no playerID to put in a round.
            expect(hit!.playerID).toBeUndefined();
        });

        it("normalises the roster, where hcp and flags arrive as strings", async () => {
            const client = await loggedInClient(http);
            http.respondWith([
                {
                    name: "Ulf User",
                    playerID: "1618037712778955",
                    shortName: "UU",
                    email: "user.name@gmail.com",
                    gender: "1",
                    hcp: 14.8,
                    hcpType: "9",
                    club: "",
                    isDefaultPlayer: 1,
                },
                {
                    name: "Tamara Tester",
                    playerID: "1619952902663",
                    shortName: "TT",
                    email: "",
                    gender: "0",
                    hcp: 54,
                    hcpType: "9",
                    club: "",
                    isDefaultPlayer: 0,
                },
            ]);

            const roster = await client.listRoster();

            expect(roster[0]).toMatchObject({ name: "Ulf User", hcp: 14.8, isDefaultPlayer: true });
            expect(roster[1]).toMatchObject({ name: "Tamara Tester", gender: "0", isDefaultPlayer: false });
        });
    });
});
