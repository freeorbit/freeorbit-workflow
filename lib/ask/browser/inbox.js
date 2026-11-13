// The inbox page in the browser: every ask, waiting ones first, read from
// /__hub/inbox every few seconds, with the waiting count in the tab's title.
(() => {
  "use strict";
  const THEMES = JSON.parse(document.getElementById("themes").textContent);
  const { ago, askerLabel, store, notifier } = window.wfAskShared;
  window.wfLook.init(THEMES, true);

  const list = document.getElementById("items");
  const summary = document.getElementById("summary");
  const filters = document.getElementById("filters");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const words = { waiting: "Waiting", partial: "Partly answered", answered: "Answered", status: "Status" };
  const liveWords = { running: "running", waiting: "waiting on you", done: "done", failed: "failed" };
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
    // Notifications are the person's to turn on: an ask that starts waiting is told once.
    let notify = null;
    if (notifier.supported()) {
      notify = el("label", "switch");
      const on = el("input");
      on.type = "checkbox";
      on.checked = notifier.on();
      on.onchange = async () => { if (on.checked) on.checked = (await notifier.enable()) === "granted"; else notifier.disable(); };
      notify.title = "A browser notification when an agent asks";
      notify.append(on, " Notify me");
    }
    filters.replaceChildren(select("Project", projects, state.project, (v) => { state.project = v; }), select("Session", sessions, state.session, (v) => { state.session = v; }), toggle, ...(notify ? [notify] : []));
    const view = shown();
    const waiting = items.filter((i) => i.state === "waiting" || i.state === "partial").length;
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
      const said = i.state === "answered" ? i.questions + " answered" : i.state === "status" ? "nothing to answer" : i.open + " of " + i.questions + " open";
      const live = i.live ? " · " + (liveWords[i.live.state] || i.live.state) + (i.live.step ? ": " + i.live.step : "") + (i.live.progress ? " (" + i.live.progress[0] + " of " + i.live.progress[1] + ")" : "") : "";
      a.append(row, el("div", "meta2", sessionName(i) + " · " + i.template + " · " + said + live));
      nodes.push(a);
    });
    // Rows glide when an ask moves up or down the list; a new one comes in.
    window.wfMotion.glide(() => list.children, () => list.replaceChildren(...nodes), (n) => n.getAttribute("href") || n.textContent);
  }
  async function load() {
    try {
      const res = await fetch("/__hub/inbox", { cache: "no-store" });
      items = (await res.json()).items || [];
      const settled = (i) => i.state === "answered" || i.state === "status";
      items.sort((a, b) => settled(a) - settled(b) || sessionOf(a).localeCompare(sessionOf(b)) || b.asked.localeCompare(a.asked));
      draw();
      notifier.check(items);
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