import type { Player } from '@hector/schemas/src/players.ts'

/**
 * The part of a player a person writes, as opposed to the part a scrape fills
 * in.
 *
 * Four fields, and they are the four `data-ownership.md` names under "What the
 * admin UI owes this": `club` and `misc` are plainly authored, `biography` is
 * authored the moment somebody edits it, and `handicap` is a *stopgap* rather
 * than an override — editable, and replaced by WiseGolf as soon as WiseGolf has
 * a figure.
 *
 * What is not here is as deliberate. `id` is the document key, the filename and
 * the player's address on the public site, so changing it would break every link
 * to them and orphan every `participants` entry that names them. `name`,
 * `contact`, `gender`, `privacy` and `aliases` are authored too and stay
 * read-only for now: nothing has asked to change them, and `aliases` in
 * particular is a list external scoring systems match against, which wants its
 * own thinking rather than a text box added by symmetry. `image` is not content
 * this service holds at all — the files are on disk and no player sets the field.
 */
export type PlayerDetails = Pick<Player, 'club' | 'handicap' | 'misc' | 'biography'>

/** What the boxes hold, before any of it is believed. */
export type PlayerForm = {
    club: string
    handicap: string
    misc: string
    biography: string
}

/** The stored player as the boxes should first show them. */
export function formOf(player: Player): PlayerForm {
    return {
        club: player.club ?? '',
        // The stopgap only. A page that put the *observed* handicap in this box
        // would be inviting somebody to "confirm" a number they do not own, and
        // saving it would write a stopgap that shadows the real reading until
        // some unrelated job next rewrote that player.
        handicap: player.handicap === undefined ? '' : String(player.handicap),
        misc: (player.misc ?? []).join('\n'),
        biography: (player.biography ?? []).join('\n\n'),
    }
}

/**
 * Paragraphs out of a textarea, split on blank lines.
 *
 * A biography is an array of paragraphs, and a textarea is one string, so
 * something has to decide where one paragraph ends. Blank lines rather than
 * single newlines, because the generator writes prose that a person then wraps
 * at whatever width their browser is — and treating every newline as a paragraph
 * break would turn one wrapped paragraph into six on the public page.
 */
export function paragraphsFrom(text: string): string[] {
    return text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
        .filter((paragraph) => paragraph.length > 0)
}

/** Hints out of a textarea, one per line — a hint is a line, not a paragraph. */
export function hintsFrom(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

/**
 * Reads the four out of a submitted form.
 *
 * Nothing here validates. The values go to `playerSchema`, which is the only
 * thing that decides whether a player is well formed — the same division the
 * matchplay editor draws, and for the same reason.
 *
 * An emptied box means the field is *absent* rather than empty, in every case.
 * The schema leaves optional fields out, `export.ts` writes what the schema
 * produces, and a committed `"club": ""` would be a value the site has to render
 * around where `undefined` is a state it already handles.
 */
export function detailsFromForm(values: PlayerForm): PlayerDetails {
    const misc = hintsFrom(values.misc)
    const biography = paragraphsFrom(values.biography)
    const handicap = values.handicap.trim()

    return {
        club: values.club.trim() || undefined,
        /*
         * `NaN` rather than `undefined` for something typed that is not a
         * number, so the schema refuses it and the page says so. Coercing it to
         * "no handicap" would silently discard what was typed and report a
         * successful save.
         */
        handicap: handicap === '' ? undefined : Number(handicap),
        misc: misc.length > 0 ? misc : undefined,
        biography: biography.length > 0 ? biography : undefined,
    }
}

/**
 * Whether saving this edit should take the biography over from the generator.
 *
 * `data-ownership.md` is explicit that saving an edit *is* the act of claiming
 * the field — not a checkbox beside it, because a lock somebody forgets to tick
 * is indistinguishable from no lock at all on the day the job next runs, and the
 * job runs twice a month.
 *
 * So the lock follows the text rather than a control: it is set when the saved
 * biography differs from the stored one. Saving a page where only the club
 * changed does not claim a biography nobody touched, which matters because the
 * generator's own output is worth keeping generated — a lock set by accident is
 * a biography that stops improving and nobody notices.
 */
export function biographyWasEdited(stored: Player, saved: PlayerDetails): boolean {
    const before = stored.biography ?? []
    const after = saved.biography ?? []
    return before.length !== after.length || before.some((paragraph, i) => paragraph !== after[i])
}
