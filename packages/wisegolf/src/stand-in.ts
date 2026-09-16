import { readFileSync, statSync } from "node:fs";

import { DriftingHandicapSource, type RosterEntry } from "./drifting-handicap-source.ts";
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
    console.warn(
        `WiseGolf stand-in: drifting the handicaps of ${roster.length} players from ${path}. ` +
            "Nothing here came from WiseGolf.",
    );
    return new DriftingHandicapSource({
        roster,
        seed: process.env.WISEGOLF_STAND_IN_SEED,
        startedAt: epochFrom(path),
    });
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
