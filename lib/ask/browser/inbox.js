// The inbox page in the browser: every ask, waiting ones first, read from
// /__hub/inbox every few seconds, with the waiting count in the tab's title.
(() => {
  "use strict";
  const THEMES = JSON.parse(document.getElementById("themes").textContent);
  const { ago, askerLabel, store } = window.wfAskShared;
  window.wfLook.init(THEMES, true);

  const list = document.getElementById("items");
  const summary = document.getElementById("summary");
  const filters = document.getElementById("filters");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const words = { waiting: "Waiting", partial: "Partly answered", answered: "Answered" };
  const sessionOf = (i) => (i.asker && i.asker.session) || "";
  const sessionName = (i) => askerLabel(i.asker, i.project);
  const state = Object.assign({ project: "", session: "", answered: true }, store.get("wf-ask:inbox", {}));
  let items = [];
  let cur = 0;
  function select(label, values, value, set) {
    const s = el("select", "pick");
    s.setAttribute("aria-label", label);
    s.append(new Option(label + ": all", ""));
    for (const [v, t] of values) s.append(new Option(t, v));
    s.value = value;
    s.onchange = () => { set(s.value); save(); draw(); };
    return s;
  }
  const save = () => store.set("wf-ask:inbox", state);
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
    filters.replaceChildren(select("Project", projects, state.project, (v) => { state.project = v; }), select("Session", sessions, state.session, (v) => { state.session = v; }), toggle);
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
      items.sort((a, b) => (a.state === "answered") - (b.state === "answered") || sessionOf(a).localeCompare(sessionOf(b)) || b.asked.localeCompare(a.asked));
      draw();
    } catch {
      summary.textContent = "The server is not answering; this page tries again in a moment.";
    }
  }
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const view = shown();
    if (e.key === "j" || e.key === "ArrowDown") { cur = Math.min(view.length - 1, cur + 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "k" || e.key === "ArrowUp") { cur = Math.max(0, cur - 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "Enter" && view[cur] && !e.target.closest("a")) location.assign(view[cur].href);
  });
  load();
  setInterval(load, 4000);
})();