import { describe, expect, it } from "vitest";

import { validateAvatarImagePayload } from "../../src/functions/generate-player-avatar";

/**
 * The GeneratePlayerAvatar README promises four accepted shapes for an image field and
 * a `details` array naming what was wrong when one is not. That is a table of rules,
 * and a table of rules is much cheaper to hold in place here — one call per rule — than
 * through the function's HTTP interface, where each case costs a request and can only
 * assert on the combination of both fields at once.
 */
describe("validating an avatar image payload", () => {
    const errorsFor = (image: unknown) => validateAvatarImagePayload(image, "photo");

    describe("accepts", () => {
        it("a bare base64 string", () => {
            expect(errorsFor("iVBORw0KGgo=")).toEqual([]);
        });

        it("a data URL", () => {
            expect(errorsFor("data:image/png;base64,iVBORw0KGgo=")).toEqual([]);
        });

        it("an object with `data`", () => {
            expect(errorsFor({ data: "iVBORw0KGgo=" })).toEqual([]);
        });

        it("an object with `base64`", () => {
            expect(errorsFor({ base64: "iVBORw0KGgo=" })).toEqual([]);
        });

        it("an object with `inlineData`", () => {
            expect(errorsFor({ inlineData: { data: "iVBORw0KGgo=", mimeType: "image/png" } })).toEqual([]);
        });
    });

    describe("rejects", () => {
        it("an empty string", () => {
            expect(errorsFor("")).toEqual(["photo must not be an empty string."]);
        });

        it("a string of nothing but whitespace", () => {
            expect(errorsFor("   ")).toEqual(["photo must not be an empty string."]);
        });

        it.each([
            ["a missing field", undefined],
            ["an explicit null", null],
            ["a number", 42],
        ])("%s", (_description, image) => {
            expect(errorsFor(image)).toEqual(["photo must be a base64 string, data URL string, or image object."]);
        });

        it.each([
            ["an object with none of the expected keys", { mimeType: "image/png" }],
            // An array is an object as far as `typeof` is concerned, so it lands in the
            // object branch and is turned away for having none of the three keys.
            ["an array", []],
        ])("%s", (_description, image) => {
            expect(errorsFor(image)).toEqual(["photo object must include one of: data, base64, or inlineData."]);
        });

        it("`inlineData` without a mime type", () => {
            expect(errorsFor({ inlineData: { data: "iVBORw0KGgo=" } })).toEqual([
                "photo.inlineData.mimeType must be a non-empty string.",
            ]);
        });

        it("`inlineData` without the data", () => {
            expect(errorsFor({ inlineData: { mimeType: "image/png" } })).toEqual([
                "photo.inlineData.data must be a non-empty string.",
            ]);
        });

        it("an empty `data`", () => {
            expect(errorsFor({ data: "" })).toEqual(["photo.data must not be empty when provided."]);
        });

        it("an empty `base64`", () => {
            expect(errorsFor({ base64: "  " })).toEqual(["photo.base64 must not be empty when provided."]);
        });

        it("reporting every problem at once, so a caller fixes them in one go", () => {
            expect(errorsFor({ inlineData: {} })).toEqual([
                "photo.inlineData.data must be a non-empty string.",
                "photo.inlineData.mimeType must be a non-empty string.",
            ]);
        });
    });

    it("names the field it was given, so both errors can be told apart", () => {
        expect(validateAvatarImagePayload("", "sample")).toEqual(["sample must not be an empty string."]);
    });
});
