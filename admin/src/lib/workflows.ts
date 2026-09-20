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
 * whole idea. The `schedule:` blocks are gone from the workflow files entirely:
 * a cron kept "as a backstop" is a second clock that is always wrong, and its
 * late runs are duplicates somebody has to explain every time they read the
 * Actions tab. Cloud Scheduler is the only clock now — see the trigger comment
 * in `.github/workflows/deploy-site.yml` for the cost that buys.
 *
 * Repeat runs were never the hazard, which is part of why the crons were easy
 * to drop: every handicap reading is kept, and `latestPerDay` in @hector/schemas
 * is what decides which of a day's readings the site shows. A redundant run
 * costs a row, not correctness.
 *
 * ## Adding one
 *
 * An entry here is all it takes. The API routes and the Operations page read
 * this list rather than naming workflows themselves, and so does the schedule:
 * `terraform/scheduler.tf` has two jobs that call one endpoint, which starts
 * everything marked `scheduled` — so adding a workflow to the scheduled run is
 * an entry here and no infrastructure change at all.
 *
 * `deploy-site.yml` is here now, though not on the tick: it is dispatched by a scrape
 * that has just committed, which is the only moment there is something new to
 * publish. Its backstop is the `cadence` on its entry below, not a cron.
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
        slug: 'leaderboards',
        file: 'update-leaderboards.yml',
        label: 'Tournament leaderboards',
        blurb: 'Refreshes the leaderboards of events that have started, from Google Sheets or app.hector.golf.',
        cadence: { every: '60s' }, // every 60 seconds, at most
    },
    {
        slug: 'biographies',
        file: 'update-player-biographies.yml',
        label: "Players' biographies",
        blurb: 'Regenerates every player biography with Gemini. Rewrites all 45, so an edit made in the admin does not survive it.',
        cadence: { every: '15d' }, // ~twice a month
    },
    {
        slug: 'club-memberships',
        file: 'update-player-club-memberships.yml',
        label: "Players' club memberships",
        blurb: "Fills in a player's home club from WiseGolf, for players who do not have one yet. Never overwrites a club somebody set.",
        cadence: { every: '30d' }, // ~once a month
    },
    {
        slug: 'deploy',
        file: 'deploy-site.yml',
        label: 'Deploy hector.golf',
        blurb: 'Rebuilds and publishes the public site. Started automatically when a data update commits something, and available here for when you want it anyway.',
        /*
         * We don't build and deploy the hector.golf site on every tick, and not
         * only because it is expensive.
         *
         * The tick starts the scrapes, which have not committed anything yet
         * when it fires — a deploy in the same second would publish the data
         * that was already there. The normal path is a scrape dispatching this
         * itself through `[slug]/dispatch.ts` once it has committed, which is
         * the only moment at which there is something new to publish.
         *
         * This is merely a backstop for when that normal after-edits request
         * fails. `deploy-site.yml` used to carry a `0 8,13` cron for exactly
         * this purpose, and deleting the crons would have deleted the backstop
         * with them — so it is expressed here instead, in the mechanism that
         * replaced them. It fires only when no deploy has happened in 24 hours,
         * which is to say only when the normal path is already broken.
         */
        cadence: { every: '1d' },
    },
]

/**
 * What the tick considers, in the order it considers them.
 *
 * Order is not cosmetic. These all commit to `main`, so they share one GitHub
 * concurrency group and each waits for the one before it. Deploy is last because
 * it publishes whatever the others did.
 *
 * The handicap scrape used to head this list, and is no longer on it at all: it
 * runs in this process now, as a job in `jobs/registry.ts`. The tick starts the
 * workflows first and the jobs second, so the ordering that mattered — buckets
 * before deploy — is still the ordering that happens.
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
