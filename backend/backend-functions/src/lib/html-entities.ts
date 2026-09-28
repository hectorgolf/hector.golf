/**
 * Turning `Troph&eacute;e` back into `Trophée`.
 *
 * ## Why this is here at all
 *
 * The model sometimes writes accented letters as HTML entities inside the JSON
 * it returns — `Hector Troph&eacute;e` rather than `Hector Trophée`. Nothing
 * downstream is wrong about that: the draft is stored exactly as it arrives,
 * the admin's `<textarea>` escapes the ampersand as RCDATA requires, and the
 * browser then shows the eight characters the model actually wrote. Every layer
 * behaves, and the reviewer still sees `Troph&eacute;e` in the box.
 *
 * It is the prompt's fault as much as anything — the system instruction is built
 * out of pseudo-XML tags (`<INSTRUCTIONS>`, `<PLAYER>`, `<OTHER BIOGRAPHIES>`),
 * which is a context that invites markup conventions. The prompt now says to
 * write the character, and this is what makes that a guarantee rather than a
 * request, because a prompt is a hope and a decoder is a function.
 *
 * ## What it decodes, and what it deliberately leaves alone
 *
 * Numeric references in full — `&#233;` and `&#xE9;` — since those are decidable
 * without a table, and the named set below: the 96 of HTML 4's Latin-1 block,
 * which is exactly the accented letters European prose is made of, the five XML
 * ones, and the punctuation a model reaches for (dashes, curly quotes, an
 * ellipsis, a euro sign).
 *
 * An entity outside that set is left exactly as it was found. That is the safe
 * direction: an undecoded `&hearts;` is visible in the review textarea and one
 * edit away from being fixed by the person already reading the paragraph,
 * whereas a wrong decode is a corrupted word nobody is looking for. The same
 * reasoning covers a broken reference — `&#xZZ;`, `&#999999;` — which is left
 * alone rather than guessed at.
 *
 * Text that merely contains an ampersand is untouched, because the pattern
 * requires a terminating semicolon and a known name: `Fish & Chips` has no
 * entity in it, and `AT&T;` decodes nothing because `T` is not one.
 *
 * ## Why not a dependency
 *
 * `he` and `entities` both do this properly and this package has three runtime
 * dependencies on purpose — it is a Cloud Function bundle. The complete named
 * table is some two thousand entries whose long tail is mathematical and Greek
 * symbols, none of which describes a golfer. A closed, auditable table that
 * fails visibly is the better trade here; if a biography ever needs `&aleph;`,
 * take the dependency.
 */

/**
 * HTML 4's Latin-1 names, plus the handful beyond it that prose uses.
 *
 * Generated from the codepoints 160–255 in order rather than typed, because a
 * table like this is exactly where a transposed pair sits unnoticed. Names are
 * case-sensitive, which is not a detail — `&Eacute;` and `&eacute;` are
 * different letters, and both are in here for that reason.
 */
const NAMED: Readonly<Record<string, string>> = {
    nbsp: "\u00a0",
    iexcl: "¡",
    cent: "¢",
    pound: "£",
    curren: "¤",
    yen: "¥",
    brvbar: "¦",
    sect: "§",
    uml: "¨",
    copy: "©",
    ordf: "ª",
    laquo: "«",
    not: "¬",
    shy: "\u00ad",
    reg: "®",
    macr: "¯",
    deg: "°",
    plusmn: "±",
    sup2: "²",
    sup3: "³",
    acute: "´",
    micro: "µ",
    para: "¶",
    middot: "·",
    cedil: "¸",
    sup1: "¹",
    ordm: "º",
    raquo: "»",
    frac14: "¼",
    frac12: "½",
    frac34: "¾",
    iquest: "¿",
    Agrave: "À",
    Aacute: "Á",
    Acirc: "Â",
    Atilde: "Ã",
    Auml: "Ä",
    Aring: "Å",
    AElig: "Æ",
    Ccedil: "Ç",
    Egrave: "È",
    Eacute: "É",
    Ecirc: "Ê",
    Euml: "Ë",
    Igrave: "Ì",
    Iacute: "Í",
    Icirc: "Î",
    Iuml: "Ï",
    ETH: "Ð",
    Ntilde: "Ñ",
    Ograve: "Ò",
    Oacute: "Ó",
    Ocirc: "Ô",
    Otilde: "Õ",
    Ouml: "Ö",
    times: "×",
    Oslash: "Ø",
    Ugrave: "Ù",
    Uacute: "Ú",
    Ucirc: "Û",
    Uuml: "Ü",
    Yacute: "Ý",
    THORN: "Þ",
    szlig: "ß",
    agrave: "à",
    aacute: "á",
    acirc: "â",
    atilde: "ã",
    auml: "ä",
    aring: "å",
    aelig: "æ",
    ccedil: "ç",
    egrave: "è",
    eacute: "é",
    ecirc: "ê",
    euml: "ë",
    igrave: "ì",
    iacute: "í",
    icirc: "î",
    iuml: "ï",
    eth: "ð",
    ntilde: "ñ",
    ograve: "ò",
    oacute: "ó",
    ocirc: "ô",
    otilde: "õ",
    ouml: "ö",
    divide: "÷",
    oslash: "ø",
    ugrave: "ù",
    uacute: "ú",
    ucirc: "û",
    uuml: "ü",
    yacute: "ý",
    thorn: "þ",
    yuml: "ÿ",

    // Beyond Latin-1: the five XML ones and the punctuation prose actually uses.
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    OElig: "Œ",
    oelig: "œ",
    Scaron: "Š",
    scaron: "š",
    Yuml: "Ÿ",
    fnof: "ƒ",
    circ: "ˆ",
    tilde: "˜",
    ensp: "\u2002",
    emsp: "\u2003",
    thinsp: "\u2009",
    ndash: "–",
    mdash: "—",
    lsquo: "‘",
    rsquo: "’",
    sbquo: "‚",
    ldquo: "“",
    rdquo: "”",
    bdquo: "„",
    dagger: "†",
    Dagger: "‡",
    bull: "•",
    hellip: "…",
    permil: "‰",
    prime: "′",
    Prime: "″",
    lsaquo: "‹",
    rsaquo: "›",
    euro: "€",
    trade: "™",
};

/** A character reference: `&name;`, `&#233;` or `&#xE9;`. */
const REFERENCE = /&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g;

/**
 * The character a numeric reference names, or undefined when it names nothing.
 *
 * Surrogates and out-of-range values are refused rather than coerced:
 * `String.fromCodePoint` throws on them, and a decoder that threw would turn one
 * malformed biography into a failed run. `\uFFFD` is not substituted either,
 * because a replacement character is a corruption that looks deliberate.
 */
function fromNumeric(reference: string): string | undefined {
    const hex = reference[1] === "x" || reference[1] === "X";
    const code = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return undefined;
    if (code >= 0xd800 && code <= 0xdfff) return undefined;
    return String.fromCodePoint(code);
}

/** Decode the character references in one string, leaving unknown ones as they are. */
export function decodeHtmlEntities(text: string): string {
    return text.replace(REFERENCE, (whole, reference: string) =>
        (reference.startsWith("#") ? fromNumeric(reference) : NAMED[reference]) ?? whole,
    );
}

/**
 * Decode a whole biography.
 *
 * Named separately from the paragraph-level function so the call site reads as
 * what it is — the one place the model's prose enters the system — rather than
 * as a map with a string function in it.
 */
export const decodeBiography = (paragraphs: readonly string[]): string[] => paragraphs.map(decodeHtmlEntities);
