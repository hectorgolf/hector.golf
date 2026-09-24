/**
 * Where an event's live standings come from, read off its `leaderboardSheet` URL.
 *
 * The two patterns were previously inlined in the update workflow. They are here
 * because three readers now need the same question answered, and each of them
 * would otherwise carry a regular expression matching a hostname: the site, at
 * build time, because only an app.hector.golf event can be polled from the
 * browser — only that source has an endpoint behind the leaderboard proxy; the
 * workflow, which updates the sheet-sourced events; and the admin's leaderboards
 * job, which updates the app-sourced ones.
 *
 * A hostname test that disagrees with itself between two of those is how an event
 * gets updated twice or not at all, so there is one.
 */

const APP_HECTOR_GOLF = /^https:\/\/app\.hector\.golf\//;
const GOOGLE_SHEETS = /^https?:\/\/docs\.google\.com\/spreadsheets\//;

/**
 * Event identifiers we are willing to pass upstream.
 *
 * The leaderboard proxy applies the same rule on its own side — it has to, since it
 * is the only thing standing between a query parameter and an outbound request.
 * Keep the two in step.
 */
export const APP_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isAppHectorGolfLeaderboard = (url: string | undefined): url is string => {
    return !!url && APP_HECTOR_GOLF.test(url);
};

export const isGoogleSheetsLeaderboard = (url: string | undefined): url is string => {
    return !!url && GOOGLE_SHEETS.test(url);
};

/** The `event` parameter of an app.hector.golf leaderboard URL, if it has a usable one. */
export const appEventIdFromLeaderboardUrl = (url: string | undefined): string | undefined => {
    if (!isAppHectorGolfLeaderboard(url)) return undefined;
    let parameter: string | null = null;
    try {
        parameter = new URL(url).searchParams.get("event");
    } catch {
        return undefined;
    }
    const eventId = parameter?.trim();
    return eventId && APP_EVENT_ID_PATTERN.test(eventId) ? eventId : undefined;
};

/**
 * The spreadsheet id embedded in a Google Sheets leaderboard URL.
 *
 * Matched separately from `GOOGLE_SHEETS` because that pattern deliberately accepts
 * any spreadsheets URL, while an id can only be read out of a `/spreadsheets/d/<id>`
 * one. A sheet URL in some other shape has no id to give.
 */
const GOOGLE_SHEET_ID = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/;

export const googleSheetIdFromLeaderboardUrl = (url: string | undefined): string | undefined => {
    if (!isGoogleSheetsLeaderboard(url)) return undefined;
    return GOOGLE_SHEET_ID.exec(url)?.[1] || undefined;
};
