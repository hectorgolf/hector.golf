import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

/**
 * Reading the secrets this service holds: the GitHub token it dispatches
 * workflows and commits with, and the WiseGolf login the handicaps job scrapes
 * with.
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
 * The cost of asking every time is one API call per use: a handful a day from
 * the scheduled ticks, two more each time somebody opens the Operations page,
 * and one per button press. The handicaps job adds three per run — two for the
 * WiseGolf login and one for the commit — against six runs a day. Secret
 * Manager's free tier is 10,000 access operations a month, so this rounds to
 * nothing and no cache is worth the staleness it would introduce.
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

/**
 * Where the WiseGolf login lives, by the same rule as the GitHub token above:
 * the *location* is configuration and the value never is.
 *
 * Two secrets rather than one document with both, because Secret Manager
 * versions the whole payload and a password rotation should not require
 * rewriting the username beside it.
 *
 * Unset is a supported state. A deployment that has not been given WiseGolf
 * credentials runs the handicaps job against a `NullHandicapSource`, which finds
 * nothing and records a sweep that reached nobody — see `sweepOf` in
 * `jobs/handicaps.ts` for why that is deliberately not an error.
 */
export const wisegolfUsernameSecret = process.env.WISEGOLF_USERNAME_SECRET
export const wisegolfPasswordSecret = process.env.WISEGOLF_PASSWORD_SECRET

/**
 * The bearer token the private Cloud Functions check, for the one this service
 * calls: `GeneratePlayerBiography`.
 *
 * The same `astrosite-api-key` the site's workflows present, and shared rather
 * than duplicated because the function compares the header against exactly one
 * value — `token !== process.env.ASTROSITE_API_KEY` in
 * `generate-player-biography/index.ts`. A key of the admin's own would mean
 * teaching that function to accept a set and redeploying it, which is a change
 * to a deployed function in service of a tidiness nothing is asking for yet.
 *
 * The cost of sharing is worth stating: rotating it rotates it for both callers
 * at once, so the biographies job and the site's workflows fail together.
 *
 * Unset is a supported state, as with WiseGolf. A deployment without it runs the
 * biographies job as far as deciding who would be rewritten, and stops there.
 */
export const backendFunctionsKeySecret = process.env.ASTROSITE_API_KEY_SECRET

/**
 * Where the key app.hector.golf checks lives, by the same rule as the others:
 * the *location* is configuration and the value never is.
 *
 * The same `hector-app-api-key` the `TournamentLeaderboard` function presents,
 * and shared for the same reason it shares the biography key: app.hector.golf
 * compares the header against one value, so a key of the admin's own would be a
 * change on somebody else's side in service of a tidiness nothing is asking for.
 *
 * Unset is a supported state. The leaderboards job reports it as `not-configured`
 * — a setup step rather than a failure — which is what the 503 on
 * `/api/jobs/leaderboards/run` is saying.
 */
export const hectorAppKeySecret = process.env.HECTOR_APP_API_KEY_SECRET

export type SecretLocation = { project: string; secretId: string }

/**
 * The project and secret id pulled back out of the resource name, so that the
 * help text on `/operations` can print the exact `gcloud` command to run rather
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
 *
 * Takes the resource name rather than reading one, because there are two now:
 * the GitHub token and the key the biography function checks. The parsing is the
 * same and the reason it is safe to render is the same.
 */
export function secretLocation(resourceName: string | undefined): SecretLocation | undefined {
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
    return readSecret(githubTokenSecret, githubTokenFromEnvironment, 'the GitHub token')
}

/**
 * The WiseGolf login, or `undefined` unless *both* halves resolved.
 *
 * All-or-nothing because half a login is not a degraded credential, it is a
 * guaranteed failed authentication that would look like WiseGolf being down.
 * `@hector/wisegolf` already treats absent credentials as "run disabled and say
 * so", which is the honest outcome, so the useful thing to hand it is nothing
 * rather than a username.
 *
 * The environment fallbacks are the same variables the four GitHub Actions
 * workflows already use, so `npm run dev` against a laptop `.env` works without
 * a second spelling to remember.
 */
export async function wisegolfCredentials(): Promise<{ username: string; password: string } | undefined> {
    const [username, password] = await Promise.all([
        readSecret(wisegolfUsernameSecret, process.env.WISEGOLF_USERNAME, 'the WiseGolf username'),
        readSecret(wisegolfPasswordSecret, process.env.WISEGOLF_PASSWORD, 'the WiseGolf password'),
    ])
    if (!username || !password) {
        // Logged at info rather than error: a deployment with no WiseGolf
        // credentials is a real, supported state — a fresh project, or one whose
        // owner has not put them in yet — and the job reports it as a sweep that
        // reached nobody.
        if (username || password) {
            console.warn('Only half of the WiseGolf login resolved, so the scrape will run disabled')
        }
        return undefined
    }
    return { username, password }
}

/**
 * The key for the private Cloud Functions, or `undefined` when there is none.
 *
 * `ASTROSITE_API_KEY` is the environment fallback, which is the spelling the
 * site's workflows and `backend/backend-functions/.env.sample` already use — so
 * a laptop `.env` needs no second name to remember.
 */
export async function backendFunctionsKey(): Promise<string | undefined> {
    return readSecret(backendFunctionsKeySecret, process.env.ASTROSITE_API_KEY, 'the backend functions key')
}

/**
 * The key app.hector.golf checks, or `undefined` when there is none.
 *
 * `HECTOR_APP_API_KEY` is the environment fallback, which is the spelling
 * `update-leaderboards.yml` and the site's own reader already use — so a laptop
 * `.env` needs no second name to remember.
 */
export async function hectorAppKey(): Promise<string | undefined> {
    return readSecret(hectorAppKeySecret, process.env.HECTOR_APP_API_KEY, 'the app.hector.golf API key')
}

/**
 * Whether the biography function's key can be read, and if not, which way it is
 * missing.
 *
 * `readSecret` answers `undefined` for three different situations, which is
 * right for a caller that only wants the value and wrong for a page that has to
 * tell somebody what to do about it. The two that matter have different fixes:
 * `not-located` means this service was never told where the secret is, which is
 * a deployment that did not carry `ASTROSITE_API_KEY_SECRET` — or a laptop, where
 * it is normal. `unreadable` means it was told and could not read it, which is
 * the grant or an empty secret.
 */
export type KeyAvailability = 'readable' | 'not-located' | 'unreadable'

/**
 * The classification, separated from the reading so it can be tested.
 *
 * A key with no resource name behind it is still readable, and that ordering is
 * the point rather than an accident: a laptop supplies `ASTROSITE_API_KEY`
 * directly and has no business reaching this project's Secret Manager.
 */
export function keyAvailability(resourceName: string | undefined, key: string | undefined): KeyAvailability {
    if (key) return 'readable'
    return resourceName ? 'unreadable' : 'not-located'
}

/**
 * The same question, asked the way the job asks it.
 *
 * It really reads the secret rather than checking that the version exists or
 * that an IAM binding is in place, and that costs one Secret Manager call per
 * page render — which the note at the top of this file has already budgeted for.
 * A cheaper check would be a different call from the one the job makes, and a
 * check that can pass where the real call fails is worse than no check: it is
 * the reassurance without the thing being reassured about.
 *
 * The value is read and dropped. Nothing returns it and nothing renders it.
 */
export async function backendFunctionsKeyAvailability(): Promise<KeyAvailability> {
    return keyAvailability(backendFunctionsKeySecret, await backendFunctionsKey())
}

/**
 * One secret, from the environment if a laptop supplied it and from Secret
 * Manager otherwise.
 *
 * `describedAs` exists because of the rule below: the resource name must not be
 * interpolated into the log line, so the message needs some other way to say
 * which of the three secrets could not be read.
 */
async function readSecret(
    resourceName: string | undefined,
    fromEnvironment: string | undefined,
    describedAs: string
): Promise<string | undefined> {
    if (fromEnvironment) return fromEnvironment
    if (!resourceName) return undefined

    try {
        const [version] = await secrets().accessSecretVersion({ name: resourceName })
        // Secret Manager hands back bytes; the payload is written by a human, so
        // trailing whitespace from a shell heredoc is likely enough to be worth
        // trimming rather than sending to GitHub as part of the token.
        const payload = version.payload?.data?.toString().trim()
        return payload || undefined
    } catch (error) {
        // The resource name is deliberately not interpolated here, and please do
        // not add it back as a convenience. It reads to CodeQL's
        // `js/clear-text-logging` rule as a value from a sensitive environment
        // variable being written to a log — which it is not, being a path rather
        // than a credential, but the rule cannot tell those apart and is right to
        // be suspicious of the shape.
        //
        // Nothing is lost: `describedAs` says which secret this was, and the
        // Secret Manager client's own error names the resource it failed to read.
        console.error(`Could not read ${describedAs} from Secret Manager`, error)
        return undefined
    }
}
