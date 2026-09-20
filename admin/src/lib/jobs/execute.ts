import { github, type DispatchOutcome } from "../github.ts";
import { workflowBySlug, type DispatchableWorkflow } from "../workflows.ts";
import { acquire } from "./lock.ts";
import { record, type JobRun } from "./log.ts";
import { isNotConfigured, type Job } from "./registry.ts";

/**
 * Running a job: take the lease, do the work, record what happened, hand the
 * lease back.
 *
 * Extracted because there are two callers and they must not drift. The schedule
 * runs jobs through the fan-out in `api/workflows/dispatch.ts`, and a person
 * runs one through `api/jobs/[slug]/run.ts`. A job started by hand while the
 * schedule's copy is still going is exactly the collision the lease exists for,
 * so both paths taking it — in the same way, with the same holder format — is
 * the property that makes it work at all.
 */

export type Execution = {
    slug: string;
    outcome: "ok" | "failed" | "skipped";
    detail?: string;
    changes: number;
    commit?: string;
    /** Who held the lease, when this run was skipped for it. */
    heldBy?: string;
    /**
     * Which kind of skip, for the callers that have to say so out loud.
     *
     * Two things can stop a run before it starts and they want opposite
     * responses: a lease collision is transient and the next tick fixes it, a
     * missing credential is permanent until somebody acts. `api/jobs/[slug]/run.ts`
     * would otherwise have to guess from the presence of `heldBy`, and the guess
     * it was making told an admin with no GitHub token that "another run was
     * already going".
     */
    skipped?: "lease" | "not-configured";
};

/**
 * Whether a skipped run is one that never started.
 *
 * Three things are called `skipped` and only two of them are the harness's:
 * a lease collision and a missing credential both stop a run *before* it starts,
 * and `skipped` above names which. A job that ran and decided not to act — the
 * `clubs` job inside its 30-day window, the player jobs before the ownership
 * flip — returns the same word and leaves that field unset, because from the run
 * log's point of view the distinction is the same one: nothing was written.
 *
 * It is not the same distinction to a caller who pressed a button, which is why
 * this exists rather than a second `outcome === "skipped"` in the endpoint.
 * Reading the outcome alone told an admin who ran the biographies job that
 * another run of it was already going, which was the one thing that had not
 * happened.
 */
export function runNeverStarted(result: Pick<Execution, "outcome" | "skipped">): boolean {
    return result.outcome === "skipped" && result.skipped !== undefined;
}

/**
 * What a thrown job means: how to record it, and how loudly to say so.
 *
 * Pulled out of the handler because the decision is the interesting part and the
 * try/catch around it is not. The level is returned rather than logged here so
 * that it can be asserted — "this is a warning, not an error" is the whole point
 * of the distinction, and a test that cannot see the level cannot pin it.
 */
export type ThrowReport = {
    outcome: "failed" | "skipped";
    detail: string;
    level: "warn" | "error";
    skipped?: "not-configured";
};

export function reportOfThrow(error: unknown): ThrowReport {
    if (isNotConfigured(error)) {
        // A warning, because nothing is broken: the service is doing exactly
        // what an unconfigured service should do, and the fix is a setup step
        // rather than an investigation. The detail is the error's own sentence,
        // which names what was missing — better in the run log than "see Cloud
        // Logging", where there is now nothing further to see.
        return { outcome: "skipped", detail: error.message, level: "warn", skipped: "not-configured" };
    }
    return { outcome: "failed", detail: "the job threw; see Cloud Logging", level: "error" };
}

/**
 * Run one job to completion. Never throws.
 *
 * A job that throws is reported as a failed run rather than propagating, because
 * the fan-out's other work — dispatching the GitHub workflows — must not be lost
 * to a scrape that fell over. The endpoints decide what status code to put on
 * the result; this decides what happened.
 */
export async function execute(job: Job, by: string): Promise<Execution> {
    const startedAt = new Date().toISOString();

    // The holder identifies the run rather than the caller: two ticks started by
    // the same scheduler account must not look like the same holder, or the
    // second one's release would free the first one's lease.
    const held = await acquire(job.slug, `${startedAt} (${by})`);
    if (!held.acquired) {
        // Dropped rather than queued. The next tick is an hour away at most and
        // will read the same sources, so waiting buys nothing and holding a
        // Cloud Run request open to wait costs the instance.
        console.log("Skipping a job run because another holds the lease", { slug: job.slug, heldBy: held.heldBy });
        const skippedJobRun: JobRun = {
            slug: job.slug,
            startedAt,
            finishedAt: new Date().toISOString(),
            by,
            dryRun: job.dryRun,
            outcome: "skipped",
            detail: `another run has been going since ${held.since}`,
            changes: [],
        };
        await record(skippedJobRun);
        console.log(`Recorded skipping a job run because another run holds the lease`, skippedJobRun);
        return { slug: job.slug, outcome: "skipped", changes: 0, heldBy: held.heldBy, skipped: "lease" };
    }

    console.log("Running a job", { job: job.slug, dryRun: job.dryRun, by });

    let result: Awaited<ReturnType<typeof job.run>>;
    let skipped: Execution["skipped"];
    try {
        result = await job.run(job.dryRun);
    } catch (error) {
        // An unhandled failure is still a run that happened, and the run log is
        // the only place that will say so for long — the caller gets a status it
        // may not be reading, and Cloud Logging expires.
        const report = reportOfThrow(error);
        if (report.level === "warn") {
            // No stack: there is nothing in it worth reading, and a stack in the
            // logs is what makes a routine state look like an incident.
            console.warn("A job could not run", { job: job.slug, detail: report.detail });
        } else {
            console.error("A job threw", { job: job.slug }, error);
        }
        skipped = report.skipped;
        result = { outcome: report.outcome, detail: report.detail, changes: [] };
    } finally {
        await held.lease.release();
    }

    const jobRun: JobRun = {
        slug: job.slug,
        startedAt,
        finishedAt: new Date().toISOString(),
        by,
        dryRun: job.dryRun,
        outcome: result.outcome,
        detail: result.detail,
        changes: result.changes,
        commit: result.commit,
    };

    await record(jobRun);
    console.log(`Recorded job run`, jobRun);

    await publish(job, result.outcome, result.changes.length, result.deployStartsItself);

    return {
        slug: job.slug,
        outcome: result.outcome,
        detail: result.detail,
        changes: result.changes.length,
        commit: result.commit,
        skipped,
    };
}

/**
 * Ask GitHub to rebuild the site, when a job has given it something new to show.
 *
 * ## Why a job has to ask at all
 *
 * The backup this job commits lives at `data/handicaps/observations.ndjson`,
 * outside `astrosite/` and therefore outside `deploy-site.yml`'s path filter.
 * That is deliberate and step 2 moved it there on purpose — a file nothing
 * builds from should not publish the site every time it is written. The cost is
 * that nothing publishes it when it *should*, so this does.
 *
 * ## Why `changes` rather than "it committed something"
 *
 * A run commits whenever the rendered backup differs from what is in git, and
 * that includes the tick *after* a change, when it reconciles the old workflow's
 * row for a handicap it already knew about. Those rows carry the same values the
 * site is already showing — `latestPerDay` returns the same answer either way —
 * so deploying for them would spend a build to publish nothing, and would put
 * the count back to the three per change that moving the file removed.
 *
 * A run that found changes is the one where a page will actually look different.
 *
 * ## Why a run can have changed something and still not ask
 *
 * Since the bucket recompute moved here, a run can also commit *inside*
 * `astrosite/` — an event's `buckets`, which is within `deploy-site.yml`'s path
 * filter. A commit made with this service's token does trigger workflows, unlike
 * one made with `GITHUB_TOKEN`, so that push starts a deploy on its own and
 * asking for a second one would build the same commit twice.
 *
 * `deployStartsItself` is the job saying which of the two it is. It is reported
 * by the job rather than inferred here, because "did anything land under
 * `astrosite/`" is a question about what was written and this function only sees
 * a count.
 *
 * ## What a failure here is, and is not
 *
 * Not a failed run. The data is written and committed by the time this is
 * called; a deploy that did not start is a page that is late, and the
 * `cadence: { every: '1d' }` on the deploy entry is the backstop that eventually
 * publishes it anyway. Reporting the run failed would be worse than the problem:
 * it would send somebody to look at a scrape that worked perfectly.
 */
export async function publish(
    job: Job,
    outcome: JobRun["outcome"],
    changes: number,
    /** True when a commit already under `astrosite/` will start the deploy itself. */
    deployStartsItself: boolean = false,
    /** Injectable so the rules above can be tested without a GitHub. */
    dispatch: (workflow: DispatchableWorkflow) => Promise<DispatchOutcome> = (workflow) =>
        github().dispatch(workflow),
): Promise<void> {
    if (!job.publishes || job.dryRun || outcome !== "ok" || changes === 0) return;
    if (deployStartsItself) {
        console.log("Not asking for a deploy: a commit under astrosite/ has already started one", {
            job: job.slug,
            changes,
        });
        return;
    }

    const deploy = workflowBySlug("deploy");
    if (!deploy) {
        // The list is a constant in this repository, so this cannot happen
        // without somebody renaming the entry — which is exactly when a silent
        // skip would be worst, since the symptom is a site that stops updating.
        console.error("No deploy workflow to ask for a publish", { job: job.slug });
        return;
    }

    const asked = await dispatch(deploy);
    if (asked.ok) {
        console.log("Asked GitHub to publish what a job changed", { job: job.slug, changes });
    } else {
        console.error("Could not ask for a deploy after a job changed something", {
            job: job.slug,
            changes,
            reason: asked.reason,
        });
    }
}
