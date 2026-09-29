/**
 * Mint a new `hooks-api-key`, and print it once so it can be handed over.
 *
 * The key app.hector.golf presents to `POST /api/hooks/round`. There is nowhere
 * to look it up afterwards on purpose — Secret Manager will read it back to
 * somebody with the right role, but the handover is a human one and the value
 * has to be on a screen at some point. This is that point, and making it a
 * script rather than a remembered pipeline is what keeps the surrounding facts
 * attached to it: what has just stopped working, how to undo it, and what to
 * tidy up afterwards.
 *
 *   npm run rotate-hooks-api-key                  # mint, store, print
 *   npm run rotate-hooks-api-key -- --dry-run     # say what would happen; mint nothing
 *   npm run --silent rotate-hooks-api-key -- --quiet | pbcopy
 *
 * ## The thing to know before running it
 *
 * **The old key stops working the moment this finishes.** The service resolves
 * `versions/latest` on every request — that is what makes a rotation take effect
 * with no redeploy — so there is no overlap window in which both keys are
 * accepted. app.hector.golf is locked out from the second this returns until
 * somebody pastes the new value into their configuration.
 *
 * That is worth arranging around rather than discovering: rotate when the other
 * side is at a keyboard, and not in the middle of a Hector.
 *
 * ## Why it does not disable the previous version
 *
 * Because that version *is* the rollback. `latest` resolves to the highest
 * *enabled* version, so disabling the one this just created puts the previous
 * key straight back — no second rotation, no third value to get confused about.
 * Destroying or disabling the old one here would throw that away in the ten
 * minutes it is most likely to be wanted.
 *
 * Tidying up is a separate act, once the handover is confirmed, and the script
 * prints the command for it rather than doing it.
 */
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

/** The secret this rotates. The hooks service reads it as `HOOKS_API_KEY`. */
export const SECRET_ID = 'hooks-api-key'

/**
 * How much randomness the key carries: 32 bytes, base64.
 *
 * The same shape `terraform/outputs.tf` and `backend/README.md` tell you to
 * generate by hand, so a key made here and a key made with `openssl rand` are
 * indistinguishable — which matters, because both routes will be used.
 */
export const KEY_BYTES = 32

export function generateKey(): string {
    return randomBytes(KEY_BYTES).toString('base64')
}

export type Options = { dryRun: boolean; quiet: boolean; project: string }

/**
 * `hector-golf` by default, because that is the project this repository
 * describes and the one every other tool here defaults to. Overridable for a
 * rebuilt project, which the bootstrapping playbook does have.
 */
export const DEFAULT_PROJECT = 'hector-golf'

export function parseOptions(
    argv: readonly string[] = process.argv.slice(2),
    environment: NodeJS.ProcessEnv = process.env
): Options {
    const flag = (name: string) => argv.includes(`--${name}`)
    const valueOf = (name: string) => {
        const prefixed = argv.find((argument) => argument.startsWith(`--${name}=`))
        return prefixed?.slice(`--${name}=`.length)
    }
    return {
        dryRun: flag('dry-run'),
        // `--quiet` prints the key and nothing else, so the output can be piped
        // straight into a clipboard. Everything explanatory goes to stderr in
        // that mode rather than being suppressed: a silent rotation that says
        // nothing about the cutover is the one way this script could mislead.
        quiet: flag('quiet'),
        project: valueOf('project') ?? environment.GCLOUD_PROJECT_ID ?? environment.GOOGLE_CLOUD_PROJECT ?? DEFAULT_PROJECT,
    }
}

/** What to say once the version exists. Separated from the printing so it can be read in a test. */
export function report(options: { project: string; version: string; enabledVersions: readonly string[] }): string {
    const others = options.enabledVersions.filter((version) => version !== options.version)
    const lines = [
        `Added version ${options.version} of ${SECRET_ID} in ${options.project}.`,
        '',
        'The previous key STOPPED WORKING just now: the hooks service resolves',
        'versions/latest on every request, so there is no overlap. app.hector.golf is',
        'locked out until this value is in their configuration.',
        '',
        'To undo, which puts the previous key back with no further rotation:',
        `  gcloud secrets versions disable ${options.version} --secret=${SECRET_ID} --project=${options.project}`,
    ]
    if (others.length > 0) {
        lines.push(
            '',
            `Once the handover is confirmed, ${others.length} older enabled version(s) are worth`,
            'disabling — they are live credentials that nothing reads:',
            `  gcloud secrets versions disable ${others.join(' ')} --secret=${SECRET_ID} --project=${options.project}`
        )
    }
    return lines.join('\n')
}

/** The version number out of a resource name like `projects/1/secrets/x/versions/7`. */
export function versionNumber(name: string | null | undefined): string {
    return name?.split('/').pop() ?? 'unknown'
}

async function main(): Promise<void> {
    const options = parseOptions()
    const say = (message: string) => (options.quiet ? console.error(message) : console.log(message))

    if (options.dryRun) {
        say(`Would add a new version of ${SECRET_ID} in ${options.project}, and print it.`)
        say('Nothing was generated and nothing was stored.')
        return
    }

    const client = new SecretManagerServiceClient()
    const parent = `projects/${options.project}/secrets/${SECRET_ID}`
    const key = generateKey()

    let version: string
    try {
        const [created] = await client.addSecretVersion({
            parent,
            payload: { data: Buffer.from(key, 'utf8') },
        })
        version = versionNumber(created.name)
    } catch (error) {
        // The two failures worth telling apart, because they have different
        // fixes and neither is "try again".
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('NOT_FOUND')) {
            console.error(`There is no ${SECRET_ID} secret in ${options.project}.`)
            console.error('Terraform creates the container — apply terraform/ first, then run this again.')
        } else if (message.includes('PERMISSION_DENIED')) {
            console.error(`Not allowed to add a version of ${SECRET_ID} in ${options.project}.`)
            console.error('This needs secretmanager.versions.add; check `gcloud auth list` is the right account.')
        } else {
            console.error(`Could not add a version of ${SECRET_ID}: ${message}`)
        }
        process.exitCode = 1
        return
    }

    // Read back which versions are live, so the tidy-up advice names real ones
    // rather than assuming. Best-effort: a rotation that worked must not report
    // failure because the listing afterwards did not.
    let enabled: string[] = []
    try {
        const [versions] = await client.listSecretVersions({ parent })
        enabled = versions.filter((v) => v.state === 'ENABLED').map((v) => versionNumber(v.name))
    } catch {
        // Nothing to say about it; the key is stored and printed either way.
    }

    if (options.quiet) {
        console.error(report({ project: options.project, version, enabledVersions: enabled }))
        // The only thing on stdout, so `| pbcopy` gets the key and not a banner.
        process.stdout.write(key)
        return
    }

    console.log(report({ project: options.project, version, enabledVersions: enabled }))
    console.log('')
    console.log('Send this to whoever runs app.hector.golf:')
    console.log('')
    console.log(`  x-api-key: ${key}`)
    console.log('')
    console.log('It is now in your shell scrollback and nowhere else you can read it back.')
}

// Only when this file is the thing being run, so that a test can import the
// helpers above without minting a key as a side effect — the same guard
// `astrosite/src/workflows/update-leaderboards.ts` uses, and for a sharper
// reason: an accidental import here would rotate a live credential.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    await main()
}
