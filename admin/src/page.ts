import type { FirestoreStatus } from "./firestore.ts";
import type { Viewer } from "./identity.ts";

/**
 * The placeholder page.
 *
 * Its whole job is to prove the parts of the deployment that are hard to test any
 * other way: that IAP put an identity in front of the service, and that the
 * service can reach its database. It says so plainly rather than looking finished,
 * because a page that looks finished invites someone to assume it is.
 *
 * The colours are the site's own, from `astrosite/src/styles/hector.css`. They are
 * restated rather than imported because this is a separate package with no build
 * step shared with the site.
 */
function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
    );
}

function row(label: string, value: string, state: "good" | "bad" | "plain"): string {
    return `<div class="row">
      <dt>${escapeHtml(label)}</dt>
      <dd class="${state}">${escapeHtml(value)}</dd>
    </div>`;
}

export function renderStatusPage(input: {
    viewer: Viewer;
    firestore: FirestoreStatus;
    revision: string;
    projectId?: string;
}): string {
    const { viewer, firestore, revision, projectId } = input;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hector Admin</title>
<style>
  :root {
    --bg: #0a0a0c; --surface: #131215; --line: #26252b;
    --text: #efeef3; --muted: #aeacb7; --dim: #7c7a86;
    --accent: #8b79d8; --good: #7ac74f; --bad: #ee6a35;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 400 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
    display: flex; justify-content: center; padding: 3rem 1.25rem;
  }
  main { width: 100%; max-width: 40rem; display: flex; flex-direction: column; gap: 1.75rem; }
  h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.01em; }
  .eyebrow {
    margin: 0 0 0.4rem; font-family: var(--mono); font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.14em; color: var(--dim);
  }
  p { margin: 0; color: var(--muted); max-width: 54ch; }
  .card { border: 1px solid var(--line); background: var(--surface); }
  .row { display: grid; grid-template-columns: 11rem 1fr; gap: 1rem; padding: 0.75rem 1.1rem; }
  .row + .row { border-top: 1px solid var(--line); }
  dt { margin: 0; color: var(--dim); font-size: 0.85rem; }
  dd { margin: 0; font-family: var(--mono); font-size: 0.85rem; word-break: break-word; }
  dd.good { color: var(--good); }
  dd.bad { color: var(--bad); }
  footer { color: var(--dim); font-size: 0.8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  code { font-family: var(--mono); color: var(--accent); }
</style>
</head>
<body>
<main>
  <div>
    <p class="eyebrow">hector.golf</p>
    <h1>Admin service</h1>
  </div>

  <p>Nothing is built here yet. This page exists to show that the deployment works
  end to end &mdash; that IAP put an identity in front of the service, and that the
  service can reach its database.</p>

  <dl class="card">
    ${row(
        "Signed in as",
        viewer.email ?? "not signed in (no IAP header)",
        viewer.authenticated ? "good" : "bad"
    )}
    ${row(
        "Firestore",
        firestore.reachable ? `reachable — ${firestore.databaseId}` : `unreachable — ${firestore.error}`,
        firestore.reachable ? "good" : "bad"
    )}
    ${row("Project", projectId ?? "unknown", "plain")}
    ${row("Revision", revision, "plain")}
  </dl>

  <footer>Replace this page as the real admin UI lands. <code>GET /healthz</code>
  is the liveness probe and never touches Firestore.</footer>
</main>
</body>
</html>
`;
}
