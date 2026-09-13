import { describe, expect, it } from "vitest";

import { describeEvent, nth } from "../../src/lib/prompts/biography/common";

/**
 * These end up inside the prompt Gemini is asked to write a biography from, which is
 * why they matter more than their size suggests: "their 21th appearance" in the prompt
 * is "their 21th appearance" on the website.
 */
describe("describing an event", () => {
    it("puts the year in brackets after the name", () => {
        expect(describeEvent({ name: "Hector Trophée", year: 2026 })).toBe("Hector Trophée (2026)");
    });
});

describe("ordinals", () => {
    it.each([
        [1, "first"],
        [2, "second"],
        [3, "third"],
        [4, "fourth"],
        [5, "fifth"],
        [6, "sixth"],
        [7, "seventh"],
        [8, "eighth"],
        [9, "ninth"],
        [10, "tenth"],
    ])("spells %i out in words", (n, expected) => {
        expect(nth(n)).toBe(expected);
    });

    it.each([
        [1, "1st"],
        [2, "2nd"],
        [3, "3rd"],
        [10, "10th"],
    ])("uses digits for %i when asked for the short form", (n, expected) => {
        expect(nth(n, true)).toBe(expected);
    });

    it.each([
        [14, "14th"],
        [21, "21st"],
        [22, "22nd"],
        [23, "23rd"],
        [101, "101st"],
    ])("switches to digits beyond ten: %i", (n, expected) => {
        expect(nth(n)).toBe(expected);
    });

    // With thirteen Hector events in the books, a player on their eleventh appearance
    // is not hypothetical, and "their 11st appearance" is what the biography said.
    it.each([
        [11, "11th"],
        [12, "12th"],
        [13, "13th"],
        [111, "111th"],
        [112, "112th"],
        [113, "113th"],
    ])("does not let the teens take the ending their last digit suggests: %i", (n, expected) => {
        expect(nth(n)).toBe(expected);
    });
});
