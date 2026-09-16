/**
 * The Operations page's buttons, without the wait that looks like nothing
 * happening.
 *
 * This is the admin's only client-side script, and it exists because of one
 * thing the rest of the admin does not have: a button whose work takes tens of
 * seconds. A handicap sweep is 45 players against WiseGolf and two GitHub round
 * trips, and it runs *inside the request* — it has to, because `cpu_idle = true`
 * in `terraform/cloud_run.tf` throttles the CPU the moment a response is sent,
 * so there is no background half to hand it to. A plain form submit therefore
 * leaves the browser on a blank-looking page for the length of the scrape with
 * no indication that the press registered, and the reasonable thing to do in
 * front of an unresponsive button is press it again.
 *
 * So: progressive enhancement, not a rewrite. The forms stay exactly as they
 * were and still work with this file deleted or unexecuted; what this adds is
 * the fetch that replaces the navigation, the disabled button that says
 * "Running…" while it waits, and the in-place refresh of the lists afterwards.
 *
 * ## Why it asks for HTML rather than JSON
 *
 * Every endpoint behind these buttons answers a browser with a 303 back to
 * /operations and anything else with JSON. The JSON is richer, and taking it
 * would mean reimplementing here every `?ran=` / `?ranJob=` / `?failedJob=` the
 * three endpoints can produce — a second copy of a decision already written
 * down, and the first of the two to drift.
 *
 * Asking for HTML instead means `fetch` follows the redirect itself and hands
 * back the rendered page, chosen and built by the server exactly as it is for
 * the no-JavaScript path. The destination stays the server's decision; this file
 * only swaps `<main>` for the one that came back. It costs no extra request
 * either: a POST and the GET it redirects to, which is what a form submit does.
 */

/**
 * What the scripted press sends.
 *
 * `accept` is the load-bearing header — `wantsHtml()` in each endpoint branches
 * on it, and the redirect branch is the one this wants.
 *
 * The content type is convention rather than necessity: this caller is
 * same-origin, so Astro's CSRF check waves it through whatever it sends. It goes
 * in because every other caller of these endpoints sends one, and because the
 * check's branch for a POST with *no* content type at all has already cost this
 * repository a day — `test/origin.test.ts` tells that story.
 *
 * `credentials` is the IAP session cookie, which this cannot work without. It is
 * the default for a same-origin request and is written out because it is a
 * requirement rather than a preference.
 */
export const RUN_REQUEST: RequestInit = {
    method: 'POST',
    // Not a default worth leaving implicit: following the redirect is the whole
    // mechanism above, not an incidental convenience.
    redirect: 'follow',
    credentials: 'same-origin',
    headers: { accept: 'text/html', 'content-type': 'application/json' },
    body: '{}',
}

/** The buttons this file drives. The attribute is both the marker and the copy. */
const BUSY = 'button[data-busy]'

/** The notice the page keeps hidden for the one case that cannot be rendered server-side. */
const LOST_CONTACT = 'lost-contact'

/**
 * Take every button out of service while one of them is working.
 *
 * All of them, not just the one pressed: a tick and a job run contend for the
 * same lease, so the second press would be dropped with an "already running"
 * that reads like a bug rather than like an answer. Returns the undo, for the
 * paths that do not end in a fresh page.
 */
const hold = (doc: Document, pressed: HTMLButtonElement) => {
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>(BUSY)]
    const labels = new Map(buttons.map((button) => [button, button.textContent]))

    for (const button of buttons) button.disabled = true
    pressed.setAttribute('aria-busy', 'true')
    pressed.textContent = pressed.dataset.busy ?? 'Running…'

    return () => {
        for (const button of buttons) {
            button.disabled = false
            button.textContent = labels.get(button) ?? button.textContent
        }
        pressed.removeAttribute('aria-busy')
    }
}

/**
 * Put the page that came back in place of the one on screen.
 *
 * `<main>` rather than the document, so the delegated listener on `document`
 * survives and the topbar does not flicker. The scoped-style attributes are in
 * the server's markup already, so the swapped-in nodes are styled by the
 * stylesheet that is loaded.
 *
 * The scroll position is deliberately left alone. A form submit lands at the top
 * of the page; staying put is better, because the thing an admin is watching
 * after pressing a job's button is that job's card and the log under it, both of
 * which update where they are being looked at.
 */
const swapMain = (doc: Document, html: string, url: string) => {
    const next = new DOMParser().parseFromString(html, 'text/html').querySelector('main')
    const current = doc.querySelector('main')
    if (!next || !current) return false

    current.replaceWith(doc.importNode(next, true))
    /*
     * The path, without the `?ran=` that produced the notice now on screen.
     *
     * The query parameter is how the server tells this page what just happened,
     * and it has done its job by the time the answer is rendered. Left in the
     * address bar it stops being a message and becomes a claim about the page:
     * reload an hour later and /operations?ran=biographies still announces that
     * you have asked GitHub to run the biographies, which you have not. A
     * notification describes an event, and an event does not survive being
     * looked at again.
     *
     * Not pushState, for the same reason as before: what it replaces is this
     * page with staler contents, so there is nothing behind it worth a Back
     * button.
     */
    history.replaceState(null, '', addressToKeep(url))
    return true
}

/**
 * The address to leave in the bar: the path, and nothing after it.
 *
 * Its own function so that the rule is one line somebody can read and a test can
 * hold on to, rather than a `new URL(...)` in the middle of a DOM swap that
 * looks like tidiness and is the whole fix.
 */
export const addressToKeep = (url: string): string => new URL(url).pathname

/** How long a notice that reports success stays on screen. */
const NOTICE_LINGERS_MS = 10_000

/**
 * Clear the notices that have been read by being seen.
 *
 * `data-transient` marks them in the template rather than being guessed at from
 * a class here, and the guess is why: "every notice that is not `.bad`" also
 * catches the run log's empty state — *"GitHub is rate-limiting this token"*
 * where the table would be — which is not an event at all but the reason a
 * section is blank. Fading that away leaves a heading with nothing under it and
 * no explanation, which is worse than the problem being solved.
 *
 * What is marked is the outcome of a press: the three that say something ran,
 * and the two that say it was skipped. A *failure* is deliberately not marked.
 * Good news is confirmation you do not need twice; bad news is a sentence
 * somebody may want to read twice, or copy, and taking it away on a timer is
 * how a notice becomes something you have to catch.
 *
 * Nothing is lost either way. Every outcome is in the run log below, which is
 * the durable record; these are only the part that says *that one was yours*.
 */
const clearNoticesLater = (doc: Document) => {
    const transient = doc.querySelectorAll('main .notice[data-transient]')
    for (const notice of transient) {
        setTimeout(() => {
            // Via a class rather than by removing it outright, so the page does
            // not jump: the style fades it and the node goes when it is gone.
            notice.classList.add('dismissing')
            setTimeout(() => notice.remove(), 500)
        }, NOTICE_LINGERS_MS)
    }
}

/**
 * Run one button's form, and show what came back.
 *
 * The failure path is one message rather than several because there is only one
 * useful thing to say. The realistic way this breaks is an IAP session expiring
 * under a page that has been open since yesterday: the POST is redirected to
 * Google's sign-in, which a same-origin fetch cannot read, and it lands here as
 * a network error. The run may well have happened — or may never have started —
 * and pressing again is the wrong move either way, so the copy says reload.
 */
const run = async (doc: Document, form: HTMLFormElement, pressed: HTMLButtonElement) => {
    const action = form.getAttribute('action') ?? form.action
    const refocus = doc.activeElement === pressed
    doc.getElementById(LOST_CONTACT)?.setAttribute('hidden', '')

    const restore = hold(doc, pressed)

    try {
        const response = await fetch(form.action, RUN_REQUEST)
        if (!response.ok) throw new Error(`the service answered ${response.status}`)
        if (!swapMain(doc, await response.text(), response.url)) throw new Error('the reply was not the page')
        clearNoticesLater(doc)
    } catch {
        restore()
        doc.getElementById(LOST_CONTACT)?.removeAttribute('hidden')
        return
    }

    // The button that was pressed no longer exists; its replacement is in the
    // same form, with its original label. Keyboard focus follows it there rather
    // than falling back to the top of the document.
    if (refocus) doc.querySelector<HTMLButtonElement>(`form[action="${action}"] ${BUSY}`)?.focus()
}

/**
 * Wire the page up.
 *
 * Delegated from the document rather than bound to each form, because the forms
 * are replaced wholesale on every run and a listener bound to the old ones would
 * last exactly one press. A form without a `data-busy` button is not ours and is
 * left to the browser.
 */
export const enhance = (doc: Document) => {
    doc.addEventListener('submit', (event) => {
        const form = event.target
        if (!(form instanceof HTMLFormElement)) return

        const pressed = form.querySelector<HTMLButtonElement>(BUSY)
        if (!pressed) return

        event.preventDefault()
        void run(doc, form, pressed)
    })
}
