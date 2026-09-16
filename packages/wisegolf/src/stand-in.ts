import { readFileSync, statSync } from "node:fs";

import { DriftingHandicapSource, TICK_MS, type RosterEntry } from "./drifting-handicap-source.ts";
import type { HandicapSource } from "./handicap-source-api.ts";

/**
 * Choosing the stand-in, and the two things that keep it out of anything real.
 *
 * ## Why the variable names a file rather than turning on a mode
 *
 * `WISEGOLF_STAND_IN_ROSTER` is a path, so what it carries is **data**: the
 * players to pretend about, their clubs and the handicaps to drift around. That
 * is the same shape as `GITHUB_API_BASE_URL` in `admin/src/lib/github.ts` and it
 * is the shape on purpose. A boolean `WISEGOLF_FAKE=1` would be a switch that
 * selects an implementation, and `admin/scripts/dev-iap.ts` sets out at length
 * why this repository does not do that: the cheap local switch is the one that
 * ends up a build flag away from production.
 *
 * A path cannot be turned on by accident, because somebody has to have written
 * the file it names — and the only thing that writes one is `dev-fake.ts`, into
 * a temporary directory, on a laptop.
 *
 * ## Why it refuses in production anyway
 *
 * Belt and braces, and cheap. Nothing deployed sets this variable — Terraform
 * does not, and `terraform/cloud_run.tf` is where it would have to — but the
 * consequence of being wrong is a scrape that invents handicaps and a commit
 * that publishes them, which is bad enough to be worth a second lock. The
 * refusal is loud rather than silent for the reason `apiBaseUrl` throws: a
 * misconfiguration must not resolve itself into the one outcome nobody asked
 * for.
 */
export async function standInFromRoster(path: string | undefined): Promise<HandicapSource | undefined> {
    if (!path) return undefined;

    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "WISEGOLF_STAND_IN_ROSTER is set under NODE_ENV=production. " +
                "The stand-in invents handicaps, and a scrape that commits invented handicaps is " +
                "worse than one that does not run. Unset it.",
        );
    }

    const roster = rosterFrom(path);
    const tickMs = tickFrom(process.env.WISEGOLF_STAND_IN_TICK);
    const source = new DriftingHandicapSource({
        roster,
        seed: process.env.WISEGOLF_STAND_IN_SEED,
        startedAt: epochFrom(path),
        tickMs,
    });

    /*
     * The waiting time is on the line, because its absence is what makes this
     * look broken. A handicap moves every five minutes by default, so somebody
     * who starts the stand-in and presses the button reads "drifting the
     * handicaps of 24 players", sees no changes at all, and concludes the drift
     * does not work — when what actually happened is that they arrived inside
     * tick zero and nothing had moved yet.
     */
    // Only worth suggesting to somebody who has not already done it.
    const hurry = tickMs === TICK_MS ? " Set WISEGOLF_STAND_IN_TICK=10s to hurry it along." : "";
    console.warn(
        `WiseGolf stand-in: drifting the handicaps of ${roster.length} players from ${path}. ` +
            `Some of them move every ${inWords(tickMs)}, the next in ${inWords(source.msUntilNextTick())}.` +
            `${hurry} Nothing here came from WiseGolf.`,
    );
    return source;
}

/**
 * When tick zero was: the moment the roster file was written.
 *
 * Not `Date.now()`, which is the obvious choice and is wrong here. A source is
 * built per job run — `handicaps.ts` calls `createWisegolfSession` every time —
 * so an epoch taken at construction makes every run tick zero, and the handicaps
 * never move at all. The stand-in would have been a slower way of returning the
 * committed values.
 *
 * Nor a module-level constant captured on first import, which survives repeated
 * construction but not Vite's hot reload: an edit to anything in the graph
 * re-executes the module and silently rewinds the clock.
 *
 * The file's own mtime is neither. `dev-fake.ts` writes it once per session, so
 * it means "when this dev session began" — stable across job runs, across hot
 * reloads, and across the admin process restarting, which is exactly the span a
 * drifting handicap wants to be measured over.
 */
function epochFrom(path: string): number {
    return statSync(path).mtimeMs;
}

/** Durations as this repository writes them elsewhere: `30s`, `5m`, `2h`. */
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/**
 * How long a tick lasts.
 *
 * Spelled the way `workflows.ts` spells a cadence — `'10s'`, `'5m'` — rather
 * than as a bare number, because a bare number is the one that gets read as the
 * wrong unit. Parsed here with eight lines instead of `parse-duration`, which is
 * the admin's dependency and not this package's, and which would be a strange
 * thing to add for a development knob.
 *
 * A value that cannot be read is refused rather than ignored: silently falling
 * back to five minutes is indistinguishable from the drift being broken, which
 * is the exact confusion this option exists to end.
 */
export function tickFrom(value: string | undefined): number {
    if (!value) return TICK_MS;

    const match = /^(\d+)\s*([smh])$/.exec(value.trim().toLowerCase());
    if (!match) {
        throw new Error(`WISEGOLF_STAND_IN_TICK is not a duration like "30s", "5m" or "2h": ${value}`);
    }

    const milliseconds = Number(match[1]) * UNITS[match[2]!]!;
    if (milliseconds <= 0) {
        throw new Error(`WISEGOLF_STAND_IN_TICK must be longer than nothing: ${value}`);
    }
    return milliseconds;
}

/** A duration as a person would say it, for one log line. */
function inWords(milliseconds: number): string {
    if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
    const minutes = milliseconds / 60_000;
    return minutes < 60 ? `${Math.round(minutes)}m` : `${Math.round(minutes / 6) / 10}h`;
}

/**
 * The roster file: a JSON array of players.
 *
 * Validated rather than trusted, and the message names the file, because the
 * thing that writes it is a development script and the person who has to fix it
 * is looking at a dev server that will not start.
 */
export function rosterFrom(path: string): RosterEntry[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch (error) {
        throw new Error(`Could not read the WiseGolf stand-in roster at ${path}: ${(error as Error).message}`);
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(`The WiseGolf stand-in roster at ${path} is not a non-empty array of players`);
    }

    return parsed.map((entry, index) => {
        const { firstName, lastName, club, handicap } = (entry ?? {}) as Partial<RosterEntry>;
        if (!firstName || !lastName || !club || typeof handicap !== "number" || Number.isNaN(handicap)) {
            throw new Error(
                `Player ${index} in the WiseGolf stand-in roster at ${path} needs ` +
                    "firstName, lastName, club and a numeric handicap",
            );
        }
        return { firstName, lastName, club, handicap };
    });
}
