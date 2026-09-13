import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

/**
 * Reading the one secret this service holds: the GitHub token it dispatches
 * workflows with.
 *
 * ## Why it is fetched at runtime rather than mounted as an environment variable
 *
 * Cloud Run can inject a secret version straight into the container's
 * environment, which is less code than this file. It is not used here, for the
 * same reason the probes in `terraform/cloud_run.tf` point at `/livez` rather
 * than `/readyz`: a dependency that can stop the service from starting turns
 * somebody else's outage into this service being down.
 *
 * A container spec that names a secret version is exactly that kind of
 * dependency. Point it at a secret with no versions yet — a fresh project, a
 * rotation done in the wrong order — and the revision never becomes ready, so
 * the whole admin is gone because a button on one page could not work. Fetching
 * on use means that failure is a message on that one page, and everything else
 * carries on.
 *
 * It also makes rotation take effect: `versions/latest` resolves per call, so
 * `gcloud secrets versions add` is the whole rotation. The mounted variant
 * resolves once per revision and would need a redeploy nobody would remember to
 * do.
 *
 * The cost of asking every time is one API call per dispatch, on a path that
 * runs four times a day plus the occasional button press. Secret Manager's free
 * tier is 10,000 access operations a month, so this rounds to nothing and no
 * cache is worth the staleness it would introduce.
 */

/**
 * Where the token lives, as a full resource name
 * (`projects/…/secrets/…/versions/latest`). `terraform/cloud_run.tf` sets it
 * from the secret resource, so the two cannot drift.
 */
export const githubTokenSecret = process.env.GITHUB_DISPATCH_TOKEN_SECRET

/**
 * A token supplied directly, for `npm run dev` on a laptop that has no business
 * reaching this project's Secret Manager. Deployed, this is unset and the
 * secret above is the only source.
 */
const githubTokenFromEnvironment = process.env.GITHUB_DISPATCH_TOKEN

export type SecretLocation = { project: string; secretId: string }

/**
 * The project and secret id pulled back out of the resource name, so that the
 * help text on `/updates` can print the exact `gcloud` command to run rather
 * than a template with placeholders to fill in. Somebody reading that page is
 * there because something is missing; making them go and look up two values
 * first is how a page stops being help.
 *
 * Both values are safe to render. They are literals in a public repository —
 * `hector-golf` is the default of `var.project_id` and `github-dispatch-token`
 * is the `secret_id` in `terraform/secrets.tf` — so the page reveals nothing a
 * reader could not already look up. The secret's *contents* never leave the
 * process, which is the thing that matters.
 *
 * `undefined` when the service has not been told where its secret is, which is
 * the normal state on a laptop.
 */
export function githubTokenSecretLocation(resourceName = githubTokenSecret): SecretLocation | undefined {
    const match = /^projects\/([^/]+)\/secrets\/([^/]+)(?:\/versions\/.+)?$/.exec(resourceName ?? '')
    return match ? { project: match[1]!, secretId: match[2]! } : undefined
}

/**
 * Built on first use, like `firestore()` and for the same reason: constructing
 * it resolves credentials, and `astro check`, the tests and a laptop that has
 * never authenticated must all work without any.
 */
let client: SecretManagerServiceClient | undefined

function secrets(): SecretManagerServiceClient {
    client ??= new SecretManagerServiceClient()
    return client
}

/**
 * The GitHub token, or `undefined` when this deployment has not been given one.
 *
 * `undefined` is a supported state rather than an error: a project that has been
 * applied but whose token has not been created yet is a real point in the setup,
 * and the admin should still run. Callers turn it into "not configured" rather
 * than a stack trace.
 *
 * Failures to *read* a secret that is configured are different — that is a
 * broken deployment — so they are logged and then reported the same way, since
 * the page cannot do anything useful with the distinction and the log can.
 */
export async function githubToken(): Promise<string | undefined> {
    if (githubTokenFromEnvironment) return githubTokenFromEnvironment
    if (!githubTokenSecret) return undefined

    try {
        const [version] = await secrets().accessSecretVersion({ name: githubTokenSecret })
        // Secret Manager hands back bytes; the payload is a token written by a
        // human, so trailing whitespace from a shell heredoc is likely enough to
        // be worth trimming rather than sending to GitHub as part of the token.
        const payload = version.payload?.data?.toString().trim()
        return payload || undefined
    } catch (error) {
        console.error('Could not read the GitHub token', { secret: githubTokenSecret }, error)
        return undefined
    }
}
