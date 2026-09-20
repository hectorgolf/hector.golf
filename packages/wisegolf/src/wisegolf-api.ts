import { fetch } from "fetch-h2";
import { memoize } from "micro-memoize";
import { ms } from "itty-time";
import { pRateLimit } from "p-ratelimit";
import { redact } from "./strings";

import { NullHandicapSource, clubsOrRefuse, type GolfClub, type HandicapSource } from "./handicap-source-api";
import { standInFromRoster } from "./stand-in.ts";

export type WisegolfSession = HandicapSource;

/**
 * What it takes to log in, from wherever the caller keeps it.
 *
 * The environment is no longer the only answer. The admin service reads these
 * out of Secret Manager, per use and asynchronously, so that a rotation takes
 * effect without a redeploy — see `admin/src/lib/secrets.ts` for why it is done
 * that way. A module that resolved `process.env` at import time could not be
 * handed those values at all.
 */
export type WisegolfCredentials = {
    username: string;
    password: string;
};

export type WisegolfClub = {
    name: string;
    number: string;
    abbreviation: string;
    softwareVendorName?: string;
};

export type WisegolfPlayer = {
    clubMemberId: string; // "memberNO" in Wisegolf JSON
    firstName: string;
    lastName: string; // "familyName" in Wisegolf JSON
    club: WisegolfClub; // "clubId" in Wisegolf JSON
    handicap: number; // "handicapActive" in Wisegolf JSON
};

const ENV = import.meta.env || process.env || {};

/**
 * Credentials handed in by a caller, which win over the environment.
 *
 * Module state rather than a parameter threaded through every function, because
 * the two entry points that need them — `createWisegolfSession` and the memoized
 * `getWisegolfPlayerHandicap` — are separated by four layers of memoization that
 * would each have to grow a cache key for a credential that never varies within
 * a process.
 */
let providedCredentials: WisegolfCredentials | undefined;

/**
 * The credentials to log in with, or `undefined` when nobody has supplied any.
 *
 * Resolved per call rather than at import time. That is the whole point of the
 * change: this module used to read `process.env` while it was being imported,
 * which meant a consumer holding its credentials anywhere else — Secret Manager,
 * a config file, a test — could not supply them at all, and meant importing the
 * module for a type printed two lines of redacted logging as a side effect.
 */
const credentials = (): WisegolfCredentials | undefined => {
    if (providedCredentials) return providedCredentials;
    const username = ENV.WISEGOLF_USERNAME;
    const password = ENV.WISEGOLF_PASSWORD;
    return username && password ? { username, password } : undefined;
};

const standardRequestHeaders = {
    Accept: "application/json",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: "https://app.wisegolf.fi",
    Pragma: "no-cache",
    Referer: "https://app.wisegolf.fi/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "x-session-type": "wisegolf",
};

const SOURCE_NAME = "WiseGolf";

const fetchClubs = memoize(
    async (token: string): Promise<Array<WisegolfClub>> => {
        const url = "https://api.wisegolfclub.fi/api/1.0/golf/club/";
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/plain, */*",
                Authorization: `token ${token}`,
            },
        });
        if (response.ok) {
            const data = await response.json();
            const clubs = (data.rows || [])
                .map(
                    (club: any) =>
                        ({
                            name: club.name,
                            number: club.clubId,
                            abbreviation: club.abbreviation,
                            softwareVendorName: club.softwareVendorName,
                        }) as WisegolfClub,
                )
                .sort((a: WisegolfClub, b: WisegolfClub) => a.name.localeCompare(b.name));
            console.log(`Got ${clubs.length} clubs from ${SOURCE_NAME}`);
            return clubs;
        } else {
            return Promise.reject(`Failed to fetch clubs from ${url} (HTTP ${response.status})`);
        }
    },
    { expires: ms("1 hour") },
);

function convertWisegolfClubToGolfClub(club: WisegolfClub): GolfClub {
    return {
        name: club.name,
        abbreviation: club.abbreviation,
        sources: [{ name: SOURCE_NAME, id: club.number }],
    };
}

/**
 * Log in and hand back a source, or a `NullHandicapSource` when there is nothing
 * to log in with.
 *
 * `supplied` is how a caller that does not keep its credentials in the
 * environment provides them — the admin service does, reading them from Secret
 * Manager; omitting it keeps the environment behaviour the `astrosite` workflows
 * have always had. Supplying them sets them for the process, because the
 * memoized lookups below reach for them long after this function has returned.
 *
 * Missing credentials stay a warning and a null source rather than a throw. That
 * is not new, and it is load-bearing: a caller gathers its sources with
 * `Promise.allSettled` and carries on with whichever answered, so a site build on
 * a laptop with no credentials produces a run that finds nothing rather than a
 * crash.
 */
export const createWisegolfSession = async (supplied?: WisegolfCredentials): Promise<WisegolfSession> => {
    if (supplied) {
        providedCredentials = supplied;
    }

    // Before the credentials, because a laptop running against the stand-in has
    // none and should not be told off for it. See `stand-in.ts` for why the
    // variable names a roster file rather than switching on a mode, and for the
    // refusal that keeps it away from anything deployed.
    const standIn = await standInFromRoster(process.env.WISEGOLF_STAND_IN_ROSTER);
    if (standIn) return standIn;

    const configured = credentials();
    if (!configured) {
        console.warn(`Missing WiseGolf credentials: initializing a NullHandicapSource instead of Wisegolf`);
        return new NullHandicapSource(SOURCE_NAME);
    }
    console.log(`wisegolfUsername:   ${redact(configured.username)}`);
    console.log(`wisegolfPassword:   ${redact(configured.password)}`);

    try {
        const token = await login(configured.username, configured.password);
        await fetchClubs(token); // pre-fetch clubs
        return {
            name: SOURCE_NAME,
            getPlayerHandicap: async (
                firstName: string,
                lastName: string,
                clubNameOrAbbreviation: string,
            ): Promise<number | undefined> => {
                return await getWisegolfPlayerHandicap(firstName, lastName, clubNameOrAbbreviation, token);
            },
            resolveClubMembership: async (firstName: string, lastName: string): Promise<GolfClub[]> => {
                return await findWisegolfPlayerClubs(firstName, lastName, token);
            },
            getClubs: async (): Promise<GolfClub[]> => {
                return (await fetchClubs(token)).map(convertWisegolfClubToGolfClub);
            },
        };
    } catch (error: any) {
        console.error(
            `Failed to create a Wisegolf session (${
                error.message || error
            }) so returning a null handicap source for ${SOURCE_NAME}.`,
        );
        return new NullHandicapSource(SOURCE_NAME);
    }
};

const findWisegolfPlayerClubs = memoize(
    async (firstName: string, lastName: string, token: string): Promise<GolfClub[]> => {
        const clubs = await fetchClubs(token);
        const clubAbbreviations: GolfClub[] = [];
        let failed = 0;

        for (let club of clubs) {
            try {
                const player = await fetchPlayer(token, club.number, firstName, lastName);
                if (player) {
                    clubAbbreviations.push(convertWisegolfClubToGolfClub(club));
                }
            } catch {
                // Counted rather than rethrown here, so the log shows every club
                // that could not be asked rather than only the first.
                failed += 1;
            }
        }

        return clubsOrRefuse(`${firstName} ${lastName}`, clubAbbreviations, clubs.length, failed);
    },
    // `async: true` for the same reason as `fetchPlayer`: a refusal is about one
    // run's luck with the rate limiter, and caching it for an hour would make a
    // moment of throttling the answer for the rest of the morning.
    { expires: ms("1 hour"), async: true },
);

const login = memoize(
    async (username: string, password: string): Promise<string> => {
        const payload = {
            username: username,
            password: password,
            appId: "affbfa03",
            version: "2.7.0",
        };
        console.log("Logging in to WiseGolf");
        const response = await fetch("https://api.wisegolfclub.fi/api/1.0/auth", {
            method: "POST",
            headers: standardRequestHeaders,
            allowForbiddenHeaders: true,
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        return data.access_token;
    },
    { expires: ms("15 minutes") },
);

const roundToTenths = (num: number): number => Math.round(num * 10) / 10;

/**
 * What WiseGolf says about our rate, when it says anything at all.
 *
 * We throttle to 5 req/s on our side and a club-membership scan is still ~140
 * sequential requests, which drew an HTTP 429 on 2026-09-20. Before deciding
 * whether to back off, wait, or retry, it is worth knowing whether the server
 * tells us any of that — a `Retry-After`, a remaining-quota count, a reset time
 * — or whether we are entirely on our own.
 *
 * `retry-after` plus every `x-` header, rather than a list of names to look for:
 * the point is to find out what is there, and guessing at a vendor's spelling of
 * "remaining" is how you conclude there is nothing. Some noise
 * (`x-frame-options` and friends) is the price and it is worth paying once.
 */
export function rateLimitHeaders(headers: {
    entries(): IterableIterator<[string, string]>;
}): Record<string, string> {
    const reported: Record<string, string> = {};
    for (const [name, value] of headers.entries()) {
        const key = name.toLowerCase();
        if (key === "retry-after" || key.startsWith("x-")) {
            reported[key] = value;
        }
    }
    return reported;
}

/**
 * Whether a healthy response has already been reported on.
 *
 * A scan is 140 requests per player and all but one of them succeed, so logging
 * every healthy response would bury the failure we are trying to see. One line
 * per process is enough to learn what the server volunteers while it is happy;
 * failures are logged every time, because that is the case with something to
 * say.
 */
let reportedHealthyHeaders = false;

function logRateLimitHeaders(url: string, status: number, headers: Parameters<typeof rateLimitHeaders>[0]): void {
    const healthy = status >= 200 && status < 300;
    if (healthy && reportedHealthyHeaders) return;
    if (healthy) reportedHealthyHeaders = true;

    const reported = rateLimitHeaders(headers);
    const what = healthy ? "on a healthy response" : `with HTTP ${status}`;
    console.log(
        Object.keys(reported).length === 0
            ? `WiseGolf sent no Retry-After and no x- headers ${what} (${url})`
            : `WiseGolf rate-limit headers ${what}: ${JSON.stringify(reported)} (${url})`,
    );
}

/**
 * Four a second, which is a measurement rather than a round number.
 *
 * It was five, and five is 300 requests a minute. On 2026-09-20 a club-
 * membership run logged its first healthy player lookup at 18:05:02.373 and its
 * first HTTP 429 at 18:06:01.120 — 58.7 seconds of clean traffic, so roughly 294
 * requests before WiseGolf started refusing. We were not overrunning their
 * budget by much; we were sitting exactly on it, which is what the sporadic
 * pattern looked like: one refusal in 140 lookups for one player, four in 140
 * for the next.
 *
 * It also recovered inside the same run — the refusals clustered in one second
 * and the following scan finished 30 seconds later having lost only four — so
 * the window is short and refills rather than banning.
 *
 * Four a second is 240 a minute, about 20% under what was observed. It was a
 * guess with headroom when it was made; the run at 18:20:14 the same evening
 * confirmed it — 560 lookups for four players in 151 seconds, an effective 3.7 a
 * second, and not one 429. All four scans completed, so the answer that came
 * back was a real "no club matched exactly one" rather than a refusal.
 *
 * The exact threshold is still unknown and does not need to be. It is somewhere
 * above 240 a minute and somewhere at or below 300, and the useful number is the
 * one that finishes a scan.
 *
 * ## Why slower rather than a retry
 *
 * There is nothing to retry *against*. WiseGolf sends no `Retry-After` and no
 * rate headers, on a healthy response or on a 429 — checked on both, which is
 * what `logRateLimitHeaders` above was added for. Any backoff would be inventing
 * a wait, and a retry re-spends a budget we have just exhausted. Costing every
 * request a little is what actually keeps us under the limit.
 *
 * The price is wall clock. A 140-club scan goes from about 28 seconds to about
 * 35, and the four clubless players from roughly two minutes to two and a half.
 * Cloud Run gives this service 600 seconds, so there is room to go slower still
 * if 240 a minute turns out to be too fast.
 */
const fetchPlayerRateLimiter = pRateLimit({
    interval: 1000,
    rate: 4,
    concurrency: 1,
});

const fetchPlayer = memoize(
    async (
        token: string,
        clubNumber: string,
        firstName: string,
        lastName: string,
    ): Promise<WisegolfPlayer | undefined> => {
        const url = ((): string => {
            const obj = new URL(`https://api.ringsidegolf.fi/api/1.0/golf/player/`);
            obj.searchParams.append("firstname", firstName);
            obj.searchParams.append("familyname", lastName);
            obj.searchParams.append("clubid", clubNumber);
            obj.searchParams.append("memberno", "");
            return obj.href;
        })();
        const response = await fetchPlayerRateLimiter(() =>
            fetch(url, {
                headers: { ...standardRequestHeaders, authorization: `token ${token}` },
                allowForbiddenHeaders: true,
            }),
        );
        logRateLimitHeaders(url, response.status, response.headers);

        if (response.ok) {
            try {
                const data = await response.json();
                if (data?.rows?.length === 0) {
                    return undefined;
                }
                if (data.rows.length > 1) {
                    console.warn(
                        `Expected exactly one player, but found ${
                            data.length
                        } players in ${clubNumber} by name of ${firstName} ${lastName}: ${JSON.stringify(
                            data,
                            null,
                            2,
                        )}`,
                    );
                }
                const player = data.rows[0];
                const club = await fetchClub(player.clubId, token);
                return {
                    firstName: player.firstName,
                    lastName: player.familyName,
                    club: club,
                    clubMemberId: player.memberNO,
                    handicap: roundToTenths(player.handicapActive) || 0,
                } as WisegolfPlayer;
            } catch (err: any) {
                console.error(
                    `Failed to fetch player ${firstName} ${lastName} from ${JSON.stringify(clubNumber)} at ${url}: ${
                        err.message || err
                    }`,
                    err,
                );
                throw err;
            }
        } else {
            const statusText =
                response.statusText && response.statusText !== `${response.status}` ? ` ${response.statusText}` : "";
            // Carried into the message rather than only logged beside it, so the
            // one line a caller records says how long the server wanted us to
            // wait. It is also the number a retry would need, if we add one.
            const retryAfter = response.headers.get("retry-after");
            const wait = retryAfter ? `, retry-after ${retryAfter}` : "";
            console.warn(`Failed to fetch player at ${url} (HTTP ${response.status + statusText}${wait})`);
            throw new Error(`HTTP ${response.status + statusText}${wait} from ${url}`);
        }
    },
    // `undefined` now means one thing — this club answered, and the player is not
    // a member. A request that did not answer throws, because the two used to be
    // the same value and a caller counting memberships cannot tell them apart.
    // Each caller below decides what to do with the throw.
    //
    // `async: true` so a rejection is evicted rather than cached: without it
    // micro-memoize keeps the rejected promise for the full ten minutes, and one
    // throttled lookup would answer for every later call about that player.
    { expires: ms("10 minutes"), async: true },
);

/**
 * Deliberately unchanged in behaviour, now that `fetchPlayer` can throw.
 *
 * A handicap and a club membership want opposite things from a failed lookup.
 * Here the caller has already been told which club the player belongs to and is
 * asking one question of one club, so a failure costs a reading: the handicaps
 * job records nothing for that player this run and tries again on the next tick,
 * which is what it did before and is the right amount of drama for a number that
 * is re-read four times a day.
 *
 * `findWisegolfPlayerClubs` is the one that cannot swallow it, because it is
 * counting answers across 140 clubs and a missing one changes the count.
 */
const fetchHandicap = async (
    token: string,
    clubNumber: string,
    firstName: string,
    lastName: string,
): Promise<number | undefined> => {
    try {
        return (await fetchPlayer(token, clubNumber, firstName, lastName))?.handicap;
    } catch {
        // Already logged where it happened, with the URL.
        return undefined;
    }
};

const resolveClubNumber = memoize(
    async (clubNameOrNumber: string, token: string): Promise<string | undefined> => {
        const club = await fetchClub(clubNameOrNumber, token);
        return club?.number;
    },
    { expires: ms("1 hour") },
);

const fetchClub = memoize(
    async (clubNameOrNumber: string, token: string): Promise<WisegolfClub | undefined> => {
        if (!clubNameOrNumber) {
            console.warn(`No club name or number provided - cannot fetch club`);
            return undefined;
        }
        const clubs = await fetchClubs(token);
        const club = clubs.find((club) => {
            if (club.number && club.number === clubNameOrNumber) return true;
            if (club.number && club.number.replace(/^0+/, "") === clubNameOrNumber.replace(/^0+/, "")) return true;
            if (club.name && club.name.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
            if (club.abbreviation && club.abbreviation.toLowerCase() === clubNameOrNumber.toLowerCase()) return true;
            return false;
        });
        if (club) {
            return club;
        }
        return undefined;
    },
    { expires: ms("1 hour") },
);

const getWisegolfPlayerHandicap = memoize(
    async (
        firstName: string,
        lastName: string,
        clubNameOrAbbreviation: string,
        providedToken?: string,
    ): Promise<number | undefined> => {
        if (clubNameOrAbbreviation) {
            const configured = credentials();
            if (configured) {
                console.log(
                    `Fetching handicap for ${firstName} ${lastName} at ${clubNameOrAbbreviation} from ${SOURCE_NAME}`,
                );
                const token = providedToken || (await login(configured.username, configured.password));
                const clubNumber = await resolveClubNumber(clubNameOrAbbreviation, token);
                if (clubNumber) {
                    return await fetchHandicap(token, clubNumber, firstName, lastName);
                }
            }
        }
        return undefined;
    },
    { expires: ms("1 hour") },
);
