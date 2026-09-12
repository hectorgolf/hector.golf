import { writeFileSync } from "fs";

import { JSON_INDENT, serializeJson } from "@hector/schemas/src/json.ts";

/**
 * How this repository's JSON data files are written.
 *
 * The convention itself moved to `@hector/schemas` when the admin service
 * started writing these same files: one writer shared by both sides rather than
 * two that can drift. This module stays as the site's door to it, so the call
 * sites here did not all have to move at once.
 */
export { JSON_INDENT, serializeJson };

/**
 * Writes a data file, formatted as the rest of them are.
 *
 * Prefer this over `writeFileSync` plus `JSON.stringify` anywhere the result is
 * committed to the repository.
 */
export function writeJsonFile(path: string, value: unknown): void {
    writeFileSync(path, serializeJson(value));
}
