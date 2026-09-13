/**
 * The GitHub Actions workflows this service can ask GitHub to start, and why it
 * is in that business at all.
 *
 * ## Why the admin starts workflows rather than doing the work
 *
 * The repository is the database (docs/architecture.md §1): a data update is a
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
 * scripts already tolerate running twice in a day (a second run replaces that
 * day's handicap entry rather than appending a duplicate).
 *
 * ## Adding one
 *
 * An entry here is all it takes: the API route, the Admin UI and the Terraform
 * that schedules them all read this list rather than naming workflows
 * themselves. `deploy.yml` is the obvious candidate — its own `30 3,12` cron is
 * queued exactly as badly, so the site can still take hours to rebuild around
 * data that arrived on time.
 */

export type DispatchableWorkflow = {
    /** URL segment, form value, and the name of the Cloud Scheduler job. */
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
}

export const DISPATCHABLE_WORKFLOWS: readonly DispatchableWorkflow[] = [
    {
        slug: 'handicaps',
        file: 'update-handicaps.yml',
        label: "Players' official handicaps",
        blurb: 'Reads every player\'s current handicap from WiseGolf and re-sorts the buckets of any event whose buckets are still open.',
    },
    {
        slug: 'leaderboards',
        file: 'update-leaderboards.yml',
        label: 'Tournament leaderboards',
        blurb: 'Refreshes the leaderboards of events that have started, from Google Sheets or app.hector.golf.',
    },
]

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
