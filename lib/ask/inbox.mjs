// The inbox at the shared server's front page: every ask from every project
// and session, waiting ones first, so a person answers them in one place.
// It reads /__hub/inbox every few seconds, says the waiting count in the
// tab's title, and looks like the ask pages: the same theme, kept in the
// browser, from the kit or Claude Desktop.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const SCRIPT = `(() => {
  "use strict";
  const THEMES = JSON.parse(document.getElementById("themes").textContent);
  const root = document.documentElement;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const look = Object.assign({ theme: "", mode: "auto", density: "comfortable" }, get("wf-ask:look", {}));
  let desktop = get("wf-ask:desktop-theme", null);
  const dark = matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    const mode = look.mode === "auto" ? (dark.matches ? "dark" : "light") : look.mode;
    root.dataset.mode = mode;
    root.dataset.density = look.density;
    const tokens = (look.theme === "desktop" || !look.theme) && desktop && desktop[mode] ? desktop[mode] : (THEMES.themes[look.theme] || THEMES.themes[THEMES.default])[mode];
    for (const [k, v] of Object.entries(tokens || {})) if (/^--[a-z0-9-]+$/.test(k) && /^[\\d.]+\\s+[\\d.]+%\\s+[\\d.]+%$/.test(v)) root.style.setProperty(k, v);
  }
  dark.addEventListener("change", apply);
  apply();
  fetch("/__hub/theme", { cache: "no-store" }).then((r) => r.json()).then((t) => {
    desktop = t && t.ok ? { name: t.name, light: t.light, dark: t.dark } : null;
    try { desktop ? localStorage.setItem("wf-ask:desktop-theme", JSON.stringify(desktop)) : localStorage.removeItem("wf-ask:desktop-theme"); } catch {}
    apply();
  }).catch(() => {});

  const list = document.getElementById("items");
  const summary = document.getElementById("summary");
  const filters = document.getElementById("filters");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ago = (iso) => { const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const words = { waiting: "Waiting", partial: "Partly answered", answered: "Answered" };
  const sessionOf = (i) => (i.asker && i.asker.session) || "";
  const sessionName = (i) => [i.asker && i.asker.project || i.project, i.asker && (i.asker.worktree || i.asker.branch), sessionOf(i) ? "session " + sessionOf(i).replace(/^local_/, "").slice(0, 8) : ""].filter(Boolean).join(" · ");
  const state = Object.assign({ project: "", session: "", answered: true }, get("wf-ask:inbox", {}));
  let items = [];
  let cur = 0;
  function select(name, label, values, value, set) {
    const s = el("select", "pick");
    s.setAttribute("aria-label", label);
    s.append(new Option(label + ": all", ""));
    for (const [v, t] of values) s.append(new Option(t, v));
    s.value = value;
    s.onchange = () => { set(s.value); save(); draw(); };
    return s;
  }
  function save() { try { localStorage.setItem("wf-ask:inbox", JSON.stringify(state)); } catch {} }
  function shown() {
    return items.filter((i) => (!state.project || i.key === state.project) && (!state.session || sessionOf(i) === state.session) && (state.answered || i.state !== "answered"));
  }
  function draw() {
    const projects = [...new Map(items.map((i) => [i.key, (i.asker && i.asker.project) || i.project])).entries()];
    const sessions = [...new Map(items.filter(sessionOf).map((i) => [sessionOf(i), sessionName(i)])).entries()];
    const toggle = el("label", "switch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = state.answered;
    box.onchange = () => { state.answered = box.checked; save(); draw(); };
    toggle.append(box, " Show answered");
    filters.replaceChildren(select("project", "Project", projects, state.project, (v) => { state.project = v; }), select("session", "Session", sessions, state.session, (v) => { state.session = v; }), toggle);
    const view = shown();
    const waiting = items.filter((i) => i.state !== "answered").length;
    document.title = (waiting ? "(" + waiting + ") " : "") + "Asks";
    summary.textContent = items.length ? waiting + " waiting · " + items.length + " in all · J and K move, Enter opens" : "Nothing asked yet. A page an agent builds with npx wf ask page shows up here.";
    cur = Math.max(0, Math.min(cur, view.length - 1));
    // With asks waiting from several sessions, each session gets its own heading.
    const bySession = new Set(view.filter((i) => i.state !== "answered").map(sessionOf)).size > 1;
    const nodes = [];
    let last = null;
    view.forEach((i, n) => {
      if (bySession && sessionOf(i) !== last) { nodes.push(el("div", "sess", sessionName(i) || "Unnamed session")); last = sessionOf(i); }
      const a = el("a", "item-row " + i.state + (n === cur ? " cur" : ""));
      a.href = i.href;
      a.dataset.n = n;
      const row = el("div", "row1");
      row.append(el("span", "state " + i.state, words[i.state]), el("span", "title", i.title), el("span", "when", ago(i.asked)));
      a.append(row, el("div", "meta2", sessionName(i) + " · " + i.template + " · " + (i.state === "answered" ? i.questions + " answered" : i.open + " of " + i.questions + " open")));
      nodes.push(a);
    });
    list.replaceChildren(...nodes);
  }
  async function load() {
    try {
      const res = await fetch("/__hub/inbox", { cache: "no-store" });
      items = (await res.json()).items || [];
      if (bySessionSort) items.sort((a, b) => (a.state === "answered") - (b.state === "answered") || sessionOf(a).localeCompare(sessionOf(b)) || b.asked.localeCompare(a.asked));
      draw();
    } catch {
      summary.textContent = "The server is not answering; this page tries again in a moment.";
    }
  }
  const bySessionSort = true;
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const view = shown();
    if (e.key === "j" || e.key === "ArrowDown") { cur = Math.min(view.length - 1, cur + 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "k" || e.key === "ArrowUp") { cur = Math.max(0, cur - 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "Enter" && view[cur] && !e.target.closest("a")) location.assign(view[cur].href);
  });
  load();
  setInterval(load, 4000);
})();`;

/** The inbox page, styled like the ask pages. */
export function inboxHtml() {
  const css = readFileSync(join(HERE, "client.css"), "utf8");
  const themes = readFileSync(join(HERE, "themes.json"), "utf8").replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asks</title>
<style>
${css}</style>
</head>
<body>
<main class="inbox">
<h1>Asks</h1>
<p class="summary" id="summary" role="status" aria-live="polite">Loading…</p>
<div class="filters" id="filters"></div>
<nav id="items" aria-label="Every ask"></nav>
</main>
<script type="application/json" id="themes">${themes}</script>
<script>
${SCRIPT}
</script>
</body>
</html>
`;
}
