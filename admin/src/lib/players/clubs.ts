import type { GolfClub } from '@hector/wisegolf/src/handicap-source-api.ts'

import { github } from '../github.ts'
import { CLUBS_PATH } from '../jobs/clubs.ts'

/**
 * The club abbreviations the editor offers, from the committed list.
 *
 * This is what `astrosite/src/data/clubs.json` was kept for. Nothing in the
 * repository reads it — it is not imported, not globbed, and sits under `src/`
 * rather than `public/`, so it is not served either — and it was kept anyway
 * because it is the only list of valid club abbreviations anywhere here and the
 * player editor would want one. This is the editor.
 *
 * ## It suggests rather than constrains
 *
 * Rendered into a `<datalist>`, so the box stays a text box: a club WiseGolf has
 * not listed can still be typed. That is not laxity, it is the current state of
 * the data — nothing enforces that a club somebody typed is in this list, and
 * until 2026-09-20 one was not, when two players carried `KJKG`, which WiseGolf
 * does not list. All twenty-four values in use match today. A `<select>` would
 * make this page unable to represent a player it can already display, which is a
 * worse failure than a typo.
 *
 * ## An empty list is a working page
 *
 * A picker is a convenience, and it is the only thing here that needs GitHub —
 * so a failed read costs the suggestions and nothing else. That matters on a
 * laptop, where there is no token at all and every other part of this editor
 * works fine. The alternative, letting the read throw, would make a missing
 * GitHub token stop somebody correcting a club abbreviation by hand, which is
 * the exact task this page exists for.
 */
export async function clubAbbreviations(): Promise<GolfClub[]> {
    try {
        const outcome = await github().readFile(CLUBS_PATH)
        if (!outcome.ok || !outcome.file.present) return []

        const parsed = JSON.parse(outcome.file.text) as GolfClub[] | { clubs?: GolfClub[] }
        const clubs = Array.isArray(parsed) ? parsed : (parsed.clubs ?? [])
        return clubs.filter((club) => typeof club?.abbreviation === 'string')
    } catch {
        // Unparseable, unreachable, or not configured — all the same answer here.
        return []
    }
}
