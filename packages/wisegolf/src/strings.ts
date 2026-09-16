/**
 * Enough of `astrosite/src/code/strings.ts` for this package to log without
 * leaking.
 *
 * Copied rather than imported, and deliberately: a five-line pure function is
 * cheaper to duplicate than a dependency edge from a package back into the
 * application it was lifted out of. `astrosite` keeps its own copy, which is
 * still the one its leaderboards and workflows use. Kept character for
 * character identical to that copy, so a reader diffing the two sees nothing.
 */
export function redact(secret?: string | null | undefined, ifMissing?: string): string {
    if (secret === "" && ifMissing === undefined) {
        return "<EMPTY>";
    }
    return secret ? secret.replace(/./g, "*") : (ifMissing ?? "<MISSING>");
}
