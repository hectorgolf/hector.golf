import { expect, describe, it } from "vitest";
import { redact } from "../../src/code/strings";

describe("redact()", () => {
    describe("empty input", () => {
        it("renders '<EMPTY>' by default", () => {
            expect(redact("")).toBe("<EMPTY>");
        });
        it("renders the provided placeholder", () => {
            expect(redact("", "missing")).toBe("missing");
        });
    });

    describe("undefined or null input", () => {
        [undefined, null].forEach((value) => {
            it(`renders '<MISSING>' by default for ${value}`, () => {
                expect(redact(value)).toBe("<MISSING>");
            });
            it(`renders the provided placeholder for ${value}`, () => {
                expect(redact(value, "custom")).toBe("custom");
            });
        });
    });

    describe("non-empty input", () => {
        it("replaces each character with an asterisk", () => {
            expect(redact("123")).toBe("***");
            expect(redact("abcdef")).toBe("******");
            expect(redact("abc 123")).toBe("*******");
        });
    });
});
