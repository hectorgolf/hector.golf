/**
 * Turning a stored contact detail into something clickable.
 *
 * The homepage is already a URL and needs nothing. A phone number is not: the
 * 17 courses carry it in four different spellings, because it has always been
 * a string nobody had to agree on —
 *
 * - `+4327643500`
 * - `tel:+43227520075`
 * - `tel://+43227520075`
 * - `tel://+421347001234`
 *
 * — and only one of those is a working `href`. `tel://` in particular is not:
 * `tel` is not a hierarchical scheme, so the `//` starts an authority and the
 * number becomes a host. Browsers mostly cope, and "mostly" is not what a link
 * on a page somebody is about to click should be.
 *
 * So the spelling is normalised for the link and dropped from the text. Fixing
 * the stored values instead would be the other way round and is still worth
 * doing; this makes the page right whether that happens or not.
 */

/** What to dial: a `tel:` URI, or nothing when there is no number in there. */
export function telHref(phone: string | undefined): string | undefined {
    const number = telText(phone)
    return number === undefined ? undefined : `tel:${number}`
}

/**
 * The number as a person should read it: the scheme taken off, nothing else
 * touched.
 *
 * Spaces and brackets are left exactly as they were found. They are somebody's
 * formatting of their own phone number and none of this function's business —
 * and `tel:` allows them, so the href survives them too.
 */
export function telText(phone: string | undefined): string | undefined {
    const trimmed = phone?.trim()
    if (!trimmed) return undefined
    const bare = trimmed.replace(/^tel:(\/\/)?/i, '').trim()
    return bare === '' ? undefined : bare
}
