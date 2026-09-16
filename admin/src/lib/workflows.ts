/**
 * The GitHub Actions workflows this service can ask GitHub to start, and why it
 * is in that business at all.
 *
 * ## Why the admin starts workflows rather than doing the work
 *
 * The repository is the database (docs/current/architecture.md §1): a data update is a
 * scraper writing JSON under `astrosite/src/data/` and committing it to `main`,
 * after which a rebuild publishes it. Doing that here would mean this service
 * holding push credentials and reimplementing `scripts/commit-changes.sh`, for
 * no gain — the workflows already do the work correctly. The one thing they are
 * bad at is *starting when they were told to*.
 *
 * ## What is actually broken
 *
 * GitHub queues `schedule` events and delivers them when it has capacity, which
 * for this repository has meant hours rather than minutes. Measured across the
 * last 300 scheduled runs of `update-handicaps.yml`, not one started on time:
 *
 *     month     median lateness, 03:00 slot   13:00 slot
 *     2026-04   2h22m                         1h28m
 *     2026-06   4h13m                         2h52m
 *     2026-09   4h32m                         3h46m
 *
 * `update-leaderboards.yml` shows the same shape, so it is the repository's
 * schedule delivery rather than anything about a particular workflow.
 *
 * `workflow_dispatch` is delivered immediately, so a Cloud Scheduler job that
 * calls this service at 03:00 produces a run that starts at 03:00. That is the
 * whole idea. The `schedule:` blocks stay in the workflow files deliberately —
 * late is better than never on the day this service is the broken one, and the
 * scripts are built for running twice in a day: every handicap reading is kept,
 * and `latestPerDay` in @hector/schemas is what decides which of a day's
 * readings the site shows. A redundant run costs a row, not correctness.
 *
 * ## Adding one
 *
 * An entry here is all it takes. The API routes and the Operations page read
 * this list rather than naming workflows themselves, and so does the schedule:
 * `terraform/scheduler.tf` has two jobs that call one endpoint, which starts
 * everything marked `scheduled` — so adding a workflow to the twice-daily run is
 * an entry here and no infrastructure change at all.
 *
 * `deploy-site.yml` is here now, though not on the tick: it is dispatched by a scrape
 * that has just committed, which is the only moment there is something new to
 * publish. Its own `0 8,13` cron stays as the backstop.
 */

import type { Cadence } from './cadence.ts'

export type DispatchableWorkflow = {
    /** URL segment and form value. */
    slug: string
    /**
     * The workflow's file name, which is how GitHub's dispatch API names it.
     * The API also accepts the numeric id; the file name is used here because it
     * is reviewable — a reader can check it against `.github/workflows/`.
     */
    file: string
    label: string
    /** One line, shown beside the button that starts it. */
    blurb: string
    /**
     * How often the Cloud Scheduler tick should start this one.
     *
     * This replaced a boolean when the GitHub `schedule:` crons were deleted and
     * the tick became the only trigger — see `cadence.ts` for the whole of why.
     * A boolean could only say "every tick", which is right for the two daily
     * scrapes and 30 times too often for the two monthly ones.
     *
     * `'manual'` means the button and nothing else.
     */
    cadence: Cadence
}

export const DISPATCHABLE_WORKFLOWS: readonly DispatchableWorkflow[] = [
    {
        slug: 'handicaps',
        file: 'update-handicaps.yml',
        label: "Players' official handicaps",
        blurb: 'Reads every player\'s current handicap from WiseGolf and re-sorts the buckets of any event whose buckets are still open.',
        cadence: 'tick',
    },
    {
        slug: 'leaderboards',
        file: 'update-leaderboards.yml',
        label: 'Tournament leaderboards',
        blurb: 'Refreshes the leaderboards of events that have started, from Google Sheets or app.hector.golf.',
        cadence: 'tick',
    },
    {
        slug: 'biographies',
        file: 'update-player-biographies.yml',
        label: "Players' biographies",
        blurb: 'Regenerates every player biography with Gemini. Rewrites all 45, so an edit made in the admin does not survive it.',
        // Was `30 2 10,25 * *` — twice a month, delivered up to five hours late.
        //
        // Fortnightly rather than "on the 10th and 25th", because the tick cannot
        // express a date it does not fire on and staleness is the property that
        // was actually wanted. It is also the one entry where running too often
        // costs real money and real edits: every run is 45 Gemini calls and
        // overwrites every biography.
        cadence: { everyDays: 15 },
    },
    {
        slug: 'club-memberships',
        file: 'update-player-club-memberships.yml',
        label: "Players' club memberships",
        blurb: "Fills in a player's home club from WiseGolf, for players who do not have one yet. Never overwrites a club somebody set.",
        // Was `15 22 15 * *`. Its last scheduled run started at 00:19 on the
        // *16th*, which is the lateness problem arriving as a wrong calendar day.
        cadence: { everyDays: 30 },
    },
    {
        slug: 'deploy',
        file: 'deploy-site.yml',
        label: 'Deploy hector.golf',
        blurb: 'Rebuilds and publishes the public site. Started automatically when a data update commits something, and available here for when you want it anyway.',
        /*
         * Not on every tick, and not because it is expensive.
         *
         * The tick starts the scrapes, which have not committed anything yet
         * when it fires — a deploy in the same second would publish the data
         * that was already there. The normal path is a scrape dispatching this
         * itself through `[slug]/dispatch.ts` once it has committed, which is the
         * only moment at which there is something new to publish.
         *
         * A day is the backstop for when that request fails. `deploy-site.yml`
         * used to carry a `0 8,13` cron for exactly this, and deleting the crons
         * would have deleted the backstop with them — so it is expressed here
         * instead, in the mechanism that replaced them. It fires only when no
         * deploy has happened in 24 hours, which is to say only when the normal
         * path is already broken.
         */
        cadence: { everyDays: 1 },
    },
]

/**
 * What the tick considers, in the order it considers them.
 *
 * Order is not cosmetic. These all commit to `main`, so they share one GitHub
 * concurrency group and each waits for the one before it. Handicaps is first
 * because the buckets it writes are the thing an event page is most wrong about
 * when it is stale; deploy is last because it publishes whatever the others did.
 *
 * "Considers" rather than "starts": everything here is on the tick, but a
 * workflow with an interval is only dispatched when it is due. See `cadence.ts`.
 */
export const SCHEDULED_WORKFLOWS: readonly DispatchableWorkflow[] = DISPATCHABLE_WORKFLOWS.filter(
    (workflow) => workflow.cadence !== 'manual'
)

export function workflowBySlug(slug: string | undefined): DispatchableWorkflow | undefined {
    return DISPATCHABLE_WORKFLOWS.find((workflow) => workflow.slug === slug)
}

/**
 * The branch dispatched runs check out.
 *
 * A constant rather than a parameter: these workflows commit what they scrape,
 * and the only branch that should ever receive those commits is the one the site
 * is built from. Accepting a branch from the caller would turn a button in the
 * admin into a way to run a scraper from an arbitrary branch's code.
 */
export const DISPATCH_REF = 'main'
