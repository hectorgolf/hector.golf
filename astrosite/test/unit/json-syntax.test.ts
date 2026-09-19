import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");

/**
 * Get all files with the specified suffix.
 *
 * @returns Every file with the given suffix under a directory, recursively.
 */
function filesWithSuffix(directory: string, suffix: string): string[] {
    const entries = readdirSync(directory).map((name) => join(directory, name));
    return entries.flatMap((path) =>
        statSync(path).isDirectory() ? filesWithSuffix(path, suffix) : path.endsWith(suffix) ? [path] : [],
    );
}

const json = filesWithSuffix(SRC, ".json");
if (json.length > 0) {
    describe("*.json files are syntactically valid JSON", () => {
        for (const file of json) {
            it(file, () => {
                const content = readFileSync(file, "utf-8");
                expect(() => JSON.parse(content)).not.toThrow();
            });
        }
    });
}

const ndjson = filesWithSuffix(SRC, ".ndjson");
if (ndjson.length > 0) {
    describe("*.ndjson files are syntactically valid NDJSON", () => {
        for (const file of ndjson) {
            it(file, () => {
                const content = readFileSync(file, "utf-8");
                expect(() => content.split("\n").forEach((line) => JSON.parse(line))).not.toThrow();
            });
        }
    });
}

const jsonl = filesWithSuffix(SRC, ".jsonl");
if (jsonl.length > 0) {
    describe("*.jsonl files are syntactically valid NDJSON", () => {
        for (const file of jsonl) {
            it(file, () => {
                const content = readFileSync(file, "utf-8");
                expect(() => content.split("\n").forEach((line) => JSON.parse(line))).not.toThrow();
            });
        }
    });
}
