// The inbox page in the browser: every ask, waiting ones first, read from
// /__hub/inbox every few seconds, with the waiting count in the tab's title.
// An ask can be archived, such as one asked for a test or no longer
// relevant: it leaves the inbox and the asks menu until it is asked again,
// and Show archived lists them to take back.
(() => {
  "use strict";
  const THEMES = JSON.parse(document.getElementById("themes").textContent);
  const { ago, askerLabel, store, notifier } = window.wfAskShared;
  window.wfLook.init(THEMES, true);
  const token = document.querySelector('meta[name="wf-token"]')?.content ?? "";
  notifier.configure({ key: "__hub", id: "inbox", token });

  const list = document.getElementById("items");
  const summary = document.getElementById("summary");
  const filters = document.getElementById("filters");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const words = { waiting: "Waiting", partial: "Partly answered", answered: "Answered", status: "Status" };
  const liveWords = { running: "running", waiting: "waiting on you", done: "done", failed: "failed" };
  const sessionOf = (i) => (i.asker && i.asker.session) || "";
  const sessionName = (i) => askerLabel(i.asker, i.project);
  const state = Object.assign({ project: "", session: "", asker: "", group: "", answered: true, archived: false }, store.get("wf-ask:inbox", {}));
  // On a team server, who asked each ask, and the work it came from.
  const team = () => items.some((i) => i.askedBy);
  const PR = { open: "open", draft: "draft", merged: "merged", closed: "closed" };
  const whoseAgent = (name) => (name ? name + "'s agent" : "agent");
  // How the list is grouped: by session alone, or on a team server by who asked, or by branch.
  const GROUPS = { session: (i) => [sessionOf(i), sessionName(i) || "Unnamed session"], asker: (i) => [i.askedBy || "", i.askedBy ? "Asked by " + i.askedBy : "Asked by no one named"], branch: (i) => [(i.asker && i.asker.branch) || "", (i.asker && i.asker.branch) || "No branch"] };
  const grouping = () => state.group || (team() ? "asker" : "session");
  let items = [];
  let shelved = [];
  let drawn = "";
  // Whether the last load failed, and a failed archive's words, which the next draw keeps.
  let offline = false;
  let problem = "";
  // The last archive, for a moment, so it can be taken back.
  const undoBar = el("p", "summary undo");
  undoBar.hidden = true;
  undoBar.setAttribute("role", "status");
  filters.after(undoBar);
  let undoTimer = null;
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
  function groupSelect() {
    const s = el("select", "pick");
    s.setAttribute("aria-label", "Group by");
    for (const [v, t] of [["asker", "Group: who asked"], ["branch", "Group: branch"], ["session", "Group: session"], ["none", "No groups"]]) s.append(new Option(t, v));
    s.value = grouping();
    s.onchange = () => { state.group = s.value; save(); draw(); };
    return s;
  }
  function shown() {
    const onTeam = team();
    // Who asked filters only on a team server, and a name no longer asking is let go.
    if (state.asker && (!onTeam || (state.asker !== "__me" && !items.some((i) => i.askedBy === state.asker)))) state.asker = "";
    const view = items.filter((i) => (!state.project || i.key === state.project) && (!state.session || sessionOf(i) === state.session) && (!state.asker || (state.asker === "__me" ? i.mine : i.askedBy === state.asker)) && (state.answered || i.state !== "answered"));
    if (!onTeam) return view;
    // On a team server, the agents that have waited longest come first; then each group together, in that order.
    const waited = view.filter((i) => i.waitingSince).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
    const ordered = [...waited, ...view.filter((i) => !i.waitingSince)];
    const by = grouping();
    if (by === "none") return ordered;
    // The open asks are grouped; the answered ones stay last, in their own groups, so waiting ones still come first.
    const settled = (i) => i.state === "answered" || i.state === "status";
    const group = (list) => {
      const groups = new Map();
      for (const i of list) {
        const k = GROUPS[by](i)[0];
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      }
      return [...groups.values()].flat();
    };
    return [...group(ordered.filter((i) => !settled(i))), ...group(ordered.filter(settled))];
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
    const shelf = el("label", "switch");
    const showShelf = el("input");
    showShelf.type = "checkbox";
    showShelf.checked = state.archived;
    showShelf.onchange = () => { state.archived = showShelf.checked; save(); load(); };
    shelf.append(showShelf, " Show archived");
    // Notifications are the person's to turn on: an ask that starts waiting is told once.
    let notify = null;
    if (notifier.supported()) {
      notify = el("label", "switch");
      const on = el("input");
      on.type = "checkbox";
      on.checked = notifier.on();
      on.onchange = async () => { if (on.checked) on.checked = (await notifier.enable()) === "granted"; else notifier.disable(); };
      notify.title = notifier.desktop ? "A notification on this computer when an agent asks" : "A browser notification when an agent asks";
      notify.append(on, " Notify me");
    }
    const askers = [...new Set(items.map((i) => i.askedBy).filter(Boolean))].sort().map((n) => [n, n]);
    const teamFilters = team() ? [select("Asked by", [["__me", "Me"], ...askers], state.asker, (v) => { state.asker = v; }), groupSelect()] : [];
    filters.replaceChildren(select("Project", projects, state.project, (v) => { state.project = v; }), select("Session", sessions, state.session, (v) => { state.session = v; }), ...teamFilters, toggle, shelf, ...(notify ? [notify] : []));
    const view = shown();
    const waiting = items.filter((i) => i.state === "waiting" || i.state === "partial").length;
    const blocked = items.some((i) => i.waitingSince);
    document.title = (blocked ? "● " : "") + (waiting ? "(" + waiting + ") " : "") + "Asks";
    summary.textContent = items.length ? waiting + " waiting · " + items.length + " in all · J and K move, Enter opens, A archives" : "Nothing asked yet. A page an agent builds with npx wf ask page shows up here.";
    cur = Math.max(0, Math.min(cur, view.length - 1));
    // With asks waiting from several sessions, each session gets its own heading; on a team server, each group does, when there are several.
    const by = team() ? grouping() : "session";
    const groupOf = (i) => (by === "none" ? ["", ""] : GROUPS[by](i));
    const bySession = by !== "none" && new Set((by === "session" ? view.filter((i) => i.state !== "answered") : view).map((i) => groupOf(i)[0])).size > 1;
    const nodes = [];
    let last = null;
    const row = (i, n, archived) => {
      const a = el("a", "item-row " + i.state + (n === cur ? " cur" : "") + (archived ? " archived" : ""));
      a.href = i.href;
      a.dataset.n = n;
      const row = el("div", "row1");
      row.append(el("span", "state " + i.state, words[i.state]), el("span", "title", i.title), el("span", "when", ago(i.asked)));
      const said = i.state === "answered" ? i.questions + " answered" : i.state === "status" ? "nothing to answer" : i.open + " of " + i.questions + " open";
      const live = i.live ? " · " + (liveWords[i.live.state] || i.live.state) + (i.live.step ? ": " + i.live.step : "") + (i.live.progress ? " (" + i.live.progress[0] + " of " + i.live.progress[1] + ")" : "") : "";
      // An agent blocked on it right now, as wf ask wait marks it.
      const blocked = i.waitingSince ? " · " + whoseAgent(i.waitingBy) + " waiting " + ago(i.waitingSince).replace(/ ago$/, "") : "";
      // The work it came from: its pull request, and whether that has merged.
      const pr = i.origin && i.origin.pr ? " · PR #" + i.origin.pr + " " + (PR[i.origin.prState] || "") : "";
      if (i.origin && (i.origin.prState === "merged" || i.origin.prState === "closed")) a.classList.add("stale");
      if (i.waitingSince) a.classList.add("blocked");
      // On a team server, an ask that waits on the person signed in says so.
      if (i.forYou && i.state !== "answered") a.classList.add("for-you");
      const asked = i.askedBy ? "Asked by " + (i.mine ? "you" : i.askedBy) + " · " + ((i.asker && (i.asker.worktree || i.asker.branch)) || i.project) : sessionName(i);
      a.append(row, el("div", "meta2", asked + pr + " · " + i.template + " · " + said + live + blocked + (i.forYou && i.state !== "answered" ? " · for you" : "")));
      // The archive button sits beside the link, not in it, so a click on it never opens the page.
      const wrap = el("div", "item-wrap");
      wrap.dataset.href = i.href;
      wrap.append(a);
      // An ask an agent is blocked on stays: archiving it would hide what the agent waits for.
      if (!i.waitingSince) {
        const button = el("button", "ghost archive", archived ? "Restore" : "Archive");
        button.type = "button";
        button.title = archived ? "Back to the inbox" : "Out of the inbox until it is asked again (A)";
        button.setAttribute("aria-label", (archived ? "Restore " : "Archive ") + i.title);
        button.onclick = () => archive(i, !archived);
        wrap.append(button);
      }
      return wrap;
    };
    view.forEach((i, n) => {
      if (bySession && groupOf(i)[0] !== last) { nodes.push(el("div", "sess", groupOf(i)[1])); last = groupOf(i)[0]; }
      nodes.push(row(i, n, false));
    });
    if (state.archived) {
      nodes.push(el("div", "sess", shelved.length ? "Archived" : "Nothing archived"));
      shelved.forEach((i) => nodes.push(row(i, -1, true)));
    }
    // Rows glide when an ask moves up or down the list; a new one comes in.
    // A redraw replaces the rows, so the row or button that had focus gets it back, by its ask.
    const had = document.activeElement?.closest?.(".item-wrap");
    const focus = had ? { href: had.dataset.href, button: document.activeElement.tagName === "BUTTON" } : null;
    window.wfMotion.glide(() => list.children, () => list.replaceChildren(...nodes), (n) => n.dataset.href || n.textContent);
    if (focus) [...list.querySelectorAll(".item-wrap")].find((w) => w.dataset.href === focus.href)?.querySelector(focus.button ? "button" : "a")?.focus();
  }
  /**
   * Archive an ask, or take it back, as it was asked when it was shown; an
   * archive says so, with Undo, which takes the focus and stays while the
   * pointer or the focus is on it.
   */
  async function archive(i, on) {
    try {
      const res = await fetch("/__hub/archive", { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify({ key: i.key, id: i.id, asked: i.asked, archived: on }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    } catch (err) {
      problem = "Could not " + (on ? "archive" : "restore") + " " + i.title + ": " + err.message;
      summary.textContent = problem;
      return;
    }
    problem = "";
    clearTimeout(undoTimer);
    if (on) {
      const undo = el("button", "ghost", "Undo");
      undo.type = "button";
      undo.onclick = () => { hideUndo(); archive(i, false); };
      undoBar.replaceChildren("Archived " + i.title + ". ", undo);
      undoBar.dataset.href = i.href;
      undoBar.hidden = false;
      undoLater();
      await load();
      undo.focus();
      return;
    }
    if (undoBar.dataset.href === i.href) hideUndo();
    await load();
  }
  const hideUndo = () => { clearTimeout(undoTimer); undoBar.hidden = true; };
  const undoLater = () => { clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, 10000); };
  // The Undo waits while it is read or about to be pressed.
  undoBar.addEventListener("pointerenter", () => clearTimeout(undoTimer));
  undoBar.addEventListener("focusin", () => clearTimeout(undoTimer));
  undoBar.addEventListener("pointerleave", () => { if (!undoBar.contains(document.activeElement)) undoLater(); });
  undoBar.addEventListener("focusout", (e) => { if (!undoBar.contains(e.relatedTarget)) undoLater(); });
  async function load() {
    try {
      const got = await (await fetch(state.archived ? "/__hub/inbox?archived=all" : "/__hub/inbox", { cache: "no-store" })).json();
      items = got.items || [];
      shelved = state.archived ? got.archived || [] : [];
      const settled = (i) => i.state === "answered" || i.state === "status";
      items.sort((a, b) => settled(a) - settled(b) || sessionOf(a).localeCompare(sessionOf(b)) || b.asked.localeCompare(a.asked));
      // Drawn again only when something changed, so a row is not replaced under a click on it.
      // Once a minute too, so the "4 min ago" words stay true.
      // A problem said, or a filter changed, is drawn over at once.
      const now = JSON.stringify([items, shelved, state, Math.floor(Date.now() / 60000)]);
      if (now !== drawn || offline) {
        drawn = now;
        offline = false;
        draw();
        if (problem) summary.textContent = problem;
      }
      notifier.check(items);
    } catch {
      offline = true;
      summary.textContent = "The server is not answering; this page tries again in a moment.";
    }
  }
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const view = shown();
    if (e.key === "j" || e.key === "ArrowDown") { cur = Math.min(view.length - 1, cur + 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "k" || e.key === "ArrowUp") { cur = Math.max(0, cur - 1); draw(); list.querySelector(".cur")?.focus(); e.preventDefault(); }
    if (e.key === "Enter" && view[cur] && !e.target.closest("a, button")) location.assign(view[cur].href);
    if ((e.key === "a" || e.key === "A") && !e.repeat) {
      // The row with the focus, else the current one; never one an agent waits on.
      const href = e.target.closest?.(".item-wrap")?.dataset.href;
      const target = (href && view.find((i) => i.href === href)) || view[cur];
      if (target && !target.waitingSince) archive(target, true);
      e.preventDefault();
    }
  });
  // A row reached with Tab becomes the current one, so J, K, and A start from it.
  list.addEventListener("focusin", (e) => {
    const href = e.target.closest?.(".item-wrap")?.dataset.href;
    const at = shown().findIndex((i) => i.href === href);
    if (at >= 0 && at !== cur) {
      cur = at;
      list.querySelectorAll(".item-row.cur").forEach((r) => r.classList.remove("cur"));
      e.target.closest(".item-wrap").querySelector(".item-row")?.classList.add("cur");
    }
  });
  // The server's desktop notifications are known before the first draw, so the switch shows where they work.
  notifier.init().finally(load);
  window.wfAskShared.every(load, 4000);
})();