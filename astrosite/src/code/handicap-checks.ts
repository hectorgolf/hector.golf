import { type HandicapCheck, schema as HandicapCheckSchema } from "@hector/schemas/src/handicap-checks.ts";

import { snapshot } from "./data-source.ts";

const checkData = (await snapshot()).handicapChecks;

/**
 * Every recorded sweep of the handicap sources, oldest first.
 *
 * Written by `update-handicaps.ts` on every run, whether or not anything changed —
 * which is the difference between this and the observation log in `handicaps.json`,
 * and the reason a handicap that has not moved since August can still be dated.
 */
export const getHandicapChecks = (): HandicapCheck[] =>
    checkData.map((record) => HandicapCheckSchema.parse(record));
