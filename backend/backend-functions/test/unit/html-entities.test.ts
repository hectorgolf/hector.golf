import { describe, expect, it } from "vitest";

import { decodeBiography, decodeHtmlEntities } from "../../src/lib/html-entities";

/**
 * `Troph&eacute;e` back into `Trophée`.
 *
 * The bug this exists for was not a rendering fault: the draft was stored
 * exactly as the model wrote it, the admin's `<textarea>` escaped the ampersand
 * as RCDATA requires, and the browser dutifully showed the eight characters
 * `&eacute;`. Every layer behaved. The text was wrong before any of them saw it.
 *
 * So what is worth pinning here is the decoder's *edges*, because the middle is
 * obvious and the edges are where a decoder corrupts prose: what it refuses to
 * touch matters as much as what it converts.
 */

describe("the entities a biography actually contains", () => {
    it("decodes the accented letters European prose is made of", () => {
        expect(decodeHtmlEntities("Hector Troph&eacute;e")).toBe("Hector Trophée");
        expect(decodeHtmlEntities("na&iuml;ve, jalape&ntilde;o, &Eacute;lys&eacute;es")).toBe(
            "naïve, jalapeño, Élysées",
        );
        expect(decodeHtmlEntities("&Aring;kerlund and &Ouml;sterberg")).toBe("Åkerlund and Österberg");
    });

    /** Different letters, and a case-insensitive table would silently confuse them. */
    it("keeps the case of a named entity", () => {
        expect(decodeHtmlEntities("&eacute; and &Eacute;")).toBe("é and É");
        expect(decodeHtmlEntities("&aring; and &Aring;")).toBe("å and Å");
    });

    it("decodes the punctuation a model reaches for", () => {
        expect(decodeHtmlEntities("a &mdash; b &ndash; c&hellip;")).toBe("a — b – c…");
        expect(decodeHtmlEntities("&ldquo;quoted&rdquo; and &rsquo;s")).toBe("“quoted” and ’s");
    });

    it("decodes numeric references, decimal and hex, in either case", () => {
        expect(decodeHtmlEntities("Troph&#233;e")).toBe("Trophée");
        expect(decodeHtmlEntities("Troph&#xE9;e")).toBe("Trophée");
        expect(decodeHtmlEntities("Troph&#xe9;e")).toBe("Trophée");
        expect(decodeHtmlEntities("&#128;&#8364;")).toBe("€");
    });

    it("decodes the five that mean something in markup", () => {
        expect(decodeHtmlEntities("Fish &amp; Chips &lt;now&gt; &quot;open&quot;")).toBe(
            'Fish & Chips <now> "open"',
        );
    });
});

describe("what it refuses to touch", () => {
    /**
     * The safe direction. An undecoded entity is visible in the review textarea
     * and one edit away from being fixed by the person already reading the
     * paragraph; a wrong decode is a corrupted word nobody is looking for.
     */
    it("leaves an entity it does not know exactly as it found it", () => {
        expect(decodeHtmlEntities("a &hearts; b &notareal; c")).toBe("a &hearts; b &notareal; c");
    });

    it("leaves a bare ampersand alone", () => {
        expect(decodeHtmlEntities("Fish & Chips, Marks & Spencer")).toBe("Fish & Chips, Marks & Spencer");
    });

    /** No terminating semicolon, no reference — `AT&T;` names no entity called `T`. */
    it("does not invent an entity out of an ampersand and a word", () => {
        expect(decodeHtmlEntities("AT&T and AT&T;")).toBe("AT&T and AT&T;");
        expect(decodeHtmlEntities("&eacute no semicolon")).toBe("&eacute no semicolon");
    });

    /**
     * A decoder that threw would turn one malformed biography into a failed run,
     * and one that substituted U+FFFD would produce a corruption that looks
     * deliberate. Left alone is the third option and the right one.
     */
    it("leaves a numeric reference that names no character", () => {
        expect(decodeHtmlEntities("&#1114112;")).toBe("&#1114112;");
        expect(decodeHtmlEntities("&#0;")).toBe("&#0;");
        expect(decodeHtmlEntities("&#xD800;")).toBe("&#xD800;");
    });

    /**
     * Decoding runs once rather than until nothing changes. A model that wrote
     * `&amp;eacute;` meant the literal text `&eacute;`, and decoding twice would
     * quietly turn somebody's example of an entity into the letter it names.
     */
    it("decodes once, not repeatedly", () => {
        expect(decodeHtmlEntities("&amp;eacute;")).toBe("&eacute;");
    });

    it("leaves prose with nothing to decode byte for byte", () => {
        const untouched = "Lasse returns to the Hector Trophée — naïve, “quoted”, 100% unchanged.";
        expect(decodeHtmlEntities(untouched)).toBe(untouched);
    });
});

describe("decodeBiography", () => {
    it("decodes every paragraph and keeps their order", () => {
        expect(decodeBiography(["Troph&eacute;e", "na&iuml;ve", "plain"])).toEqual(["Trophée", "naïve", "plain"]);
    });

    it("copes with an empty biography", () => {
        expect(decodeBiography([])).toEqual([]);
    });
});
