import { acquire } from "./lock.ts";
import { record, type JobRun } from "./log.ts";
import type { Job } from "./registry.ts";

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
};

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
        return { slug: job.slug, outcome: "skipped", changes: 0, heldBy: held.heldBy };
    }

    console.log("Running a job", { job: job.slug, dryRun: job.dryRun, by });

    let result: Awaited<ReturnType<typeof job.run>>;
    try {
        result = await job.run(job.dryRun);
    } catch (error) {
        // An unhandled failure is still a run that happened, and the run log is
        // the only place that will say so for long — the caller gets a status it
        // may not be reading, and Cloud Logging expires.
        console.error("A job threw", { job: job.slug }, error);
        result = { outcome: "failed", detail: "the job threw; see Cloud Logging", changes: [] };
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

    return {
        slug: job.slug,
        outcome: result.outcome,
        detail: result.detail,
        changes: result.changes.length,
        commit: result.commit,
    };
}
