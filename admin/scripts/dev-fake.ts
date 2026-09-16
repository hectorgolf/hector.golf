/**
 * The whole admin, on a laptop, talking to nothing real.
 *
 * Three stand-ins, wired together:
 *
 *   Firestore   the emulator, either one already running or one started here
 *   GitHub      `fake-github.ts`, in this process
 *   IAP         `dev-iap.ts`, which this spawns and which spawns `astro dev`
 *
 *   npm run dev:fake
 *
 * ## Why this exists as a script rather than as a paragraph in a README
 *
 * Because the combination is the point and it is easy to get half-right. An
 * admin pointed at the emulator but at real GitHub will dispatch real workflows
 * from a button that looks local; one pointed at the fake GitHub but at real
 * Firestore writes job runs into the deployed database. Both are a forgotten
 * environment variable away, and neither announces itself. One command that sets
 * all of them is the difference between a local admin and a local-looking one.
 *
 * Firestore is the piece this does not insist on owning. If
 * `FIRESTORE_EMULATOR_HOST` is already set and something is listening there,
 * that is used as-is — an emulator kept running between sessions holds its data,
 * and stopping and reseeding it on every `npm run dev:fake` would be a poor
 * trade for the tidiness.
 *
 * ## Where it may run
 *
 * Development only, enforced rather than trusted, the same as its two
 * components: it refuses NODE_ENV=production, everything binds loopback, and
 * `github.ts` will not accept a base URL that is not loopback in any case. It
 * lives in `scripts/`, which the container image does not copy.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServer, DEFAULT_PORT as FAKE_GITHUB_PORT, emptyState, seedHistory } from './fake-github.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** Where the emulator is put when this starts one. Not 8080, which Cloud Run uses. */
const EMULATOR_HOST = '127.0.0.1:8432'

/**
 * `tsx`, wherever npm put it.
 *
 * Both places, because a workspace hoists shared dependencies to the root and
 * this one is shared: looking only in `admin/node_modules` finds nothing here.
 * The same two candidates `astroBinary()` in `dev-iap.ts` searches, and for the
 * same reason.
 */
function tsxBinary(): string {
    const candidates = [join(here, '../node_modules/.bin/tsx'), join(here, '../../node_modules/.bin/tsx')]
    const found = candidates.find((candidate) => existsSync(candidate))
    if (!found) throw new Error(`could not find tsx in any of: ${candidates.join(', ')}`)
    return found
}

const listening = (hostPort: string): Promise<boolean> => {
    const [host = '127.0.0.1', port = '0'] = hostPort.split(':')
    return new Promise((resolve) => {
        const socket = net.connect({ host, port: Number(port) })
        socket.once('connect', () => {
            socket.destroy()
            resolve(true)
        })
        socket.once('error', () => {
            socket.destroy()
            resolve(false)
        })
    })
}

async function waitUntilListening(hostPort: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        if (await listening(hostPort)) return
        if (Date.now() > deadline) throw new Error(`nothing started listening on ${hostPort} within ${timeoutMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
}

/**
 * The Firestore emulator, started only if one is not already there.
 *
 * The component ships with gcloud rather than with this repository, so the
 * failure worth handling well is its absence: the message says the one command
 * that fixes it, because "spawn gcloud ENOENT" does not.
 */
async function ensureEmulator(): Promise<{ child?: ChildProcess; hostPort: string }> {
    const configured = process.env.FIRESTORE_EMULATOR_HOST
    if (configured && (await listening(configured))) {
        console.log(`Firestore emulator: using the one already on ${configured}`)
        return { hostPort: configured }
    }

    const hostPort = configured ?? EMULATOR_HOST
    console.log(`Firestore emulator: starting one on ${hostPort}`)
    const child = spawn('gcloud', ['emulators', 'firestore', 'start', `--host-port=${hostPort}`], {
        stdio: ['ignore', 'ignore', 'inherit'],
    })
    child.on('error', (error) => {
        console.error(
            `\nCould not start the Firestore emulator: ${error.message}\n` +
                'It ships with gcloud rather than with this repository:\n' +
                '  gcloud components install cloud-firestore-emulator\n' +
                'It needs a Java runtime. Or start your own and set FIRESTORE_EMULATOR_HOST.\n'
        )
        process.exit(1)
    })

    await waitUntilListening(hostPort)
    return { child, hostPort }
}

async function main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
        console.error('dev-fake is a development tool and refuses to run with NODE_ENV=production.')
        process.exit(1)
    }

    const repository = process.env.GITHUB_REPOSITORY ?? 'hectorgolf/hector.golf'
    const fakeGitHubPort = Number(process.env.FAKE_GITHUB_PORT ?? FAKE_GITHUB_PORT)

    const { DISPATCHABLE_WORKFLOWS } = await import('../src/lib/workflows.ts')
    const state = emptyState()
    seedHistory(
        state,
        DISPATCHABLE_WORKFLOWS.map((workflow) => workflow.file)
    )
    const fakeGitHub = createServer(state, repository)
    await new Promise<void>((resolve) => fakeGitHub.listen(fakeGitHubPort, '127.0.0.1', resolve))
    console.log(`fake-github: on http://127.0.0.1:${fakeGitHubPort}, answering for ${repository}`)

    const emulator = await ensureEmulator()

    const admin: ChildProcess = spawn(tsxBinary(), [join(here, 'dev-iap.ts')], {
        cwd: join(here, '..'),
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
            ...process.env,
            FIRESTORE_EMULATOR_HOST: emulator.hostPort,
            // A token is required or `github.ts` answers `not-configured` before
            // it makes a request, and the stand-in would never be reached. Its
            // value is not checked by anything; the fake only asserts that one
            // was sent, the way the real client always does.
            GITHUB_DISPATCH_TOKEN: process.env.GITHUB_DISPATCH_TOKEN ?? 'fake-github-does-not-check-this',
            GITHUB_API_BASE_URL: `http://127.0.0.1:${fakeGitHubPort}`,
            GITHUB_REPOSITORY: repository,
        },
    })

    console.log('\nIf the admin looks empty, its database is: FIRESTORE_EMULATOR_HOST=' + emulator.hostPort)
    console.log('  npm run seed -- --bootstrap\n')

    const stop = (): void => {
        admin.kill('SIGTERM')
        emulator.child?.kill('SIGTERM')
        fakeGitHub.close(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    admin.on('exit', (code) => {
        emulator.child?.kill('SIGTERM')
        fakeGitHub.close(() => process.exit(code ?? 1))
    })
}

await main()
