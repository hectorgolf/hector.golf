import { type HandicapCheck, schema as HandicapCheckSchema } from "@hector/schemas/src/handicap-checks.ts";

import { ROUTES, loadFromAdmin, readBackup } from "./admin-api";

/**
 * Every recorded sweep of the handicap sources, oldest first.
 *
 * Written by the admin service's handicaps job on every run, whether or not
 * anything changed — which is the difference between this and the observation log
 * in `handicaps.ts`, and the reason a handicap that has not moved since August
 * can still be dated.
 *
 * Resolved once, in a top-level await, for the same reason the observation log is:
 * `getHandicapChecks()` is called from the middle of building a payload and
 * making it async would turn a data-source change into a rewrite of its callers.
 *
 * It used to be `import checkData from "../data/handicap-checks.json"`. That file
 * is still written by `update-handicaps.yml` and still committed; it is no longer
 * what the site reads. See `docs/plans/handicaps-to-firestore.md`.
 */
const checkData = await loadFromAdmin<HandicapCheck>({
    path: ROUTES.checks,
    backup: readBackup("data/handicaps/checks.ndjson"),
    backupPath: "data/handicaps/checks.ndjson",
    what: "handicap sweep log",
    parse: (ndjson) =>
        ndjson
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => HandicapCheckSchema.parse(JSON.parse(line))),
});

/**
 * No `schema.parse` per call any more: `loadFromAdmin` validates every row as it
 * reads it, from the API and from the backup alike, so re-parsing here would
 * re-validate the whole log once per caller.
 */
export const getHandicapChecks = (): HandicapCheck[] => checkData;
