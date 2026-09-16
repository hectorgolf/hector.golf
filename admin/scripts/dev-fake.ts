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
import { once } from 'node:events'
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
 * Which emulator we ended up with, and whether stopping it is ours to do.
 *
 * The distinction is the whole of the shutdown logic below: an emulator that was
 * already running belongs to whoever started it, holds data they may want, and
 * must survive this process exiting.
 */
type Emulator = { hostPort: string; ours: boolean }

/**
 * The Firestore emulator, started only if one is not already there.
 *
 * The component ships with gcloud rather than with this repository, so the
 * failure worth handling well is its absence: the message says the one command
 * that fixes it, because "spawn gcloud ENOENT" does not.
 *
 * The check happens whether or not `FIRESTORE_EMULATOR_HOST` was set, which it
 * did not used to. Unset, this went straight to spawning on the default address
 * — and then `waitUntilListening` was satisfied by the emulator that was already
 * there, so a run that had failed to start its own with "Address already in use"
 * looked exactly like a run that had succeeded, and quietly used somebody else's
 * database.
 */
async function ensureEmulator(): Promise<Emulator> {
    const hostPort = process.env.FIRESTORE_EMULATOR_HOST ?? EMULATOR_HOST

    if (await listening(hostPort)) {
        console.log(`Firestore emulator: using the one already on ${hostPort} (leaving it running on exit)`)
        return { hostPort, ours: false }
    }

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

    // Raced against the child, so that an emulator which dies on the way up is
    // an error here rather than a mystery later.
    const outcome = await Promise.race([
        waitUntilListening(hostPort).then(() => 'listening' as const),
        once(child, 'exit').then(() => 'exited' as const),
    ])
    if (outcome === 'exited') {
        console.error(
            `\nThe Firestore emulator stopped before it was listening on ${hostPort}.\n` +
                'Its own output is above. "Address already in use" means something is already\n' +
                `there — \`lsof -nP -iTCP:${hostPort.split(':')[1]} -sTCP:LISTEN\` will name it.\n`
        )
        process.exit(1)
    }

    return { hostPort, ours: true }
}

/**
 * Stop the emulator, if it was ours to stop.
 *
 * Over HTTP rather than with a signal, which is not fastidiousness — it is the
 * only thing that works. `gcloud emulators firestore start` puts the emulator in
 * a **process group of its own**, so Ctrl-C never reaches it: the terminal sends
 * SIGINT to the foreground group, and the emulator is not in it. Nor does killing
 * the `gcloud` this process spawned, because the bash wrapper and the JVM below
 * it outlive their parent and reparent to init.
 *
 * The result was an emulator surviving every Ctrl-C, still holding port 8432, so
 * that the *next* `npm run dev:fake` met "Address already in use" — and, before
 * the check above existed, silently attached to the survivor instead.
 *
 * `POST /shutdown` is the emulator's own door, it answers 200, and it works
 * wherever this runs, which a process-group kill does not.
 */
async function stopEmulator(emulator: Emulator): Promise<void> {
    if (!emulator.ours) return
    try {
        await fetch(`http://${emulator.hostPort}/shutdown`, {
            method: 'POST',
            // It is on its way down and will not answer at leisure; the exit
            // must not wait on a reply that is not coming.
            signal: AbortSignal.timeout(3_000),
        })
    } catch {
        // Already gone, or never came up. Either way there is nothing left to do
        // and nothing worth saying on the way out of a development tool.
    }
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

    /**
     * One way out, however it was reached.
     *
     * Guarded, because both routes into it can happen at once: Ctrl-C signals
     * every process in the foreground group, so the admin exits of its own
     * accord *and* this handler runs, and the previous version then closed the
     * same server twice and waited for two `process.exit`es.
     *
     * `closeAllConnections` before `close`, because `close` alone waits for open
     * sockets to end on their own — one idle keep-alive to the stand-in was
     * enough for the callback never to fire, which read as a Ctrl-C that did
     * nothing at all.
     */
    let stopping = false
    const shutdown = (code: number): void => {
        if (stopping) return
        stopping = true

        admin.kill('SIGTERM')
        fakeGitHub.closeAllConnections()
        fakeGitHub.close()
        void stopEmulator(emulator).finally(() => process.exit(code))
    }

    process.on('SIGINT', () => shutdown(0))
    process.on('SIGTERM', () => shutdown(0))
    admin.on('exit', (code) => shutdown(code ?? 1))
}

await main()
