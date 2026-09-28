import { extractHectorRows, extractVictorRows, type LeaderboardData } from '@hector/schemas/src/leaderboards/app-payload.ts'
import { appTournamentResponseSchema } from '@hector/schemas/src/leaderboards/app-response.ts'

import { NotConfigured } from '../jobs/registry.ts'
import { hectorAppKey } from '../secrets.ts'

/**
 * Asking app.hector.golf what the standings are.
 *
 * The second reader of that endpoint in this repository, after
 * `astrosite/src/code/leaderboards/app.ts`, and deliberately not a shared one.
 * What the two have in common — the payload's shape and the mapping off it — is
 * shared, in `@hector/schemas/src/leaderboards/`. What differs is everything
 * around it: that one reads its key from an environment variable a workflow step
 * set, this one from Secret Manager at the moment of use, and the two disagree
 * about what a missing key means. Here it is `not-configured`, which is a setup
 * step the Operations page can name; there it is a workflow whose secret was not
 * wired up, which is a red run.
 */

export type { LeaderboardData }

/**
 * The standings for one event, or `undefined` when they could not be read.
 *
 * `undefined` rather than a throw, and the distinction is the whole safety of
 * this job: an event that has not started legitimately has empty boards, so a
 * caller must not read a failure as "no results" and publish it over standings
 * that are already live. The job leaves the committed file alone and says the run
 * failed.
 *
 * A missing key is the one failure that throws, because it is not a failure of
 * this request — nothing was asked. `NotConfigured` is what turns it into the
 * 503 that names the setup step, rather than a failed run somebody investigates.
 */
export async function fetchStandings(url: string): Promise<LeaderboardData | undefined> {
    const key = await hectorAppKey()
    if (!key) throw new NotConfigured('Reading the standings from app.hector.golf', 'an app.hector.golf API key')

    let response: Response
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { 'x-api-key': key, 'content-type': 'application/json' },
        })
    } catch (error) {
        // The URL is logged and the key never is. It comes from the event's own
        // `leaderboardSheet`, which is committed and public.
        console.error('Could not reach app.hector.golf for the standings', { url, error })
        return undefined
    }

    if (!response.ok) {
        console.error('app.hector.golf refused to give the standings', {
            url,
            status: response.status,
            statusText: response.statusText,
        })
        return undefined
    }

    let json: unknown
    try {
        json = await response.json()
    } catch (error) {
        console.error('app.hector.golf answered with something that is not JSON', { url, error })
        return undefined
    }

    const parsed = appTournamentResponseSchema.safeParse(json)
    if (!parsed.success) {
        /*
         * The payload is not logged, unlike on the site's side.
         *
         * A tournament payload names every player in the field and what they are
         * scoring, and Cloud Logging keeps this service's logs where the site's
         * workflow logs are not kept at all. The validation error says which
         * field disagreed, which is the part that is actually diagnostic.
         */
        console.error('app.hector.golf answered with a payload this service does not understand', {
            url,
            error: parsed.error.message,
        })
        return undefined
    }

    return { hector: extractHectorRows(parsed.data), victor: extractVictorRows(parsed.data) }
}
