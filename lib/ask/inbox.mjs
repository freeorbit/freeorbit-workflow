// The inbox at the shared server's front page: every ask from every project
// and session, waiting ones first, so a person answers them in one place.
// It reads /__hub/inbox every few seconds and says the waiting count in the
// tab's title.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SCRIPT = `(() => {
  "use strict";
  try {
    const look = JSON.parse(localStorage.getItem("wf-ask:look") || "{}");
    if (look.palette) document.documentElement.dataset.palette = look.palette;
    if (look.mode === "light" || look.mode === "dark") document.documentElement.dataset.theme = look.mode;
  } catch {}
  const list = document.getElementById("items");
  const summary = document.getElementById("summary");
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  };
  const words = { waiting: "Waiting", partial: "Partly answered", answered: "Answered" };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  async function load() {
    let items = [];
    try {
      const res = await fetch("/__hub/inbox", { cache: "no-store" });
      items = (await res.json()).items || [];
    } catch {
      summary.textContent = "The server is not answering; this page tries again in a moment.";
      return;
    }
    const waiting = items.filter((i) => i.state !== "answered").length;
    document.title = (waiting ? "(" + waiting + ") " : "") + "Asks";
    summary.textContent = items.length ? waiting + " waiting · " + items.length + " in all" : "Nothing asked yet.";
    list.replaceChildren(...items.map((i) => {
      const a = el("a", "item " + i.state);
      a.href = i.href;
      const top = el("div", "row");
      top.append(el("span", "state", words[i.state]), el("span", "title", i.title), el("span", "when", ago(i.asked)));
      const who = [i.asker && i.asker.project || i.project, i.asker && (i.asker.worktree || i.asker.branch), i.asker && i.asker.session ? "session " + i.asker.session.replace(/^local_/, "").slice(0, 8) : ""].filter(Boolean).join(" · ");
      const meta = el("div", "meta", who + " · " + i.template + " · " + (i.state === "answered" ? i.questions + " answered" : i.open + " of " + i.questions + " open"));
      a.append(top, meta);
      return a;
    }));
  }
  load();
  setInterval(load, 4000);
})();`;

const STYLE = `
.inbox { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
.inbox h1 { font-size: 1.3rem; margin: 0 0 4px; }
.inbox .summary { color: var(--muted); margin: 0 0 16px; }
.item { display: block; text-decoration: none; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 8px 0; }
.item:hover { border-color: var(--accent); }
.item .row { display: flex; gap: 10px; align-items: baseline; }
.item .title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .when, .item .meta { color: var(--muted); font-size: .85rem; }
.item .state { font-size: .75rem; font-weight: 600; border-radius: 999px; padding: 1px 8px; border: 1px solid var(--line); white-space: nowrap; }
.item.waiting .state { color: var(--accent); border-color: var(--accent); }
.item.partial .state { color: var(--warn); border-color: var(--warn); }
.item.answered { opacity: .7; }
.item.answered .state { color: var(--ok); }
`;

/** The inbox page, styled like the ask pages. */
export function inboxHtml() {
  const css = readFileSync(join(HERE, "client.css"), "utf8");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asks</title>
<style>
${css}${STYLE}</style>
</head>
<body>
<main class="inbox">
<h1>Asks</h1>
<p class="summary" id="summary" role="status" aria-live="polite">Loading…</p>
<nav id="items" aria-label="Every ask"></nav>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}
