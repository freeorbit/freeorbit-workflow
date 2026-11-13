// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- other asks: the switcher in the header --------------------------------------
  let inbox = [];
  const here = `/${key}/ask/${spec.id}/`;
  function waitingQueue() { return inbox.filter((i) => i.state === "waiting" || i.state === "partial").sort((a, b) => a.asked.localeCompare(b.asked)); }
  function nextAsk() { const q = waitingQueue(); const i = q.findIndex((x) => x.href === here); return i >= 0 ? q[i + 1] ?? q.find((x) => x.href !== here) : q[0]; }
  function prevAsk() { const q = waitingQueue(); const i = q.findIndex((x) => x.href === here); return i > 0 ? q[i - 1] : null; }
  let prefetched = "";
  function asksRefresh() {
    const others = waitingQueue().filter((x) => x.href !== here);
    asksBox.hidden = !served;
    const next = nextAsk();
    const prev = prevAsk();
    asksBox.replaceChildren(
      h("button", { type: "button", "aria-label": "Previous waiting ask ([)", title: prev ? `Previous: ${prev.title}` : "No earlier ask waiting", disabled: !prev, onclick: () => prev && location.assign(prev.href) }, "‹"),
      h("button", { type: "button", class: `count ${others.length ? "waiting" : ""}`, title: "Every ask", onclick: (e) => asksPop(e.currentTarget) }, others.length ? [`${others.length}`, h("span", null, " waiting")] : "No other asks"),
      h("button", { type: "button", "aria-label": "Next waiting ask (])", title: next ? `Next: ${next.title}` : "No other ask waiting", disabled: !next, onclick: () => next && location.assign(next.href) }, "›"));
    if (next && prefetched !== next.href) {
      prefetched = next.href;
      document.head.querySelectorAll("link[data-next]").forEach((l) => l.remove());
      document.head.append(h("link", { rel: "prefetch", href: next.href, "data-next": "1" }));
    }
  }
  function asksPop(anchor) {
    const items = inbox.slice(0, 30);
    popAt(anchor, h("div", { class: "h" }, "Asks"),
      items.map((i) => h("a", { class: `item ${i.href === here ? "on" : ""}`, href: i.href }, h("span", { class: `state ${i.state}` }, ({ waiting: "Waiting", partial: "Partly", status: "Status" })[i.state] ?? "Answered"), h("span", { class: "t" }, i.title), h("span", { class: "s" }, `${i.asker?.project || i.project} · ${ago(i.asked)}`))),
      h("a", { class: "item", href: "/" }, h("span", { class: "t" }, "Open the inbox"), h("kbd", null, "I")));
  }
  async function pollInbox() {
    try { inbox = (await (await fetch("/__hub/inbox", { cache: "no-store" })).json()).items ?? []; asksRefresh(); waitingSignals(inbox); } catch { /* the server is away; the page keeps working */ }
  }
  async function pollVersion() {
    try {
      const res = await fetch(`/__ask/${encodeURIComponent(key)}/version/${encodeURIComponent(spec.id)}`, { cache: "no-store" });
      if (res.ok) newer.hidden = (await res.json()).hash === spec.hash;
    } catch { /* away */ }
  }
  const newer = h("div", { class: "notice warn", hidden: true, role: "status" }, h("span", { class: "grow" }, "The agent has a newer version of this page. Your answers here are kept."), h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Load it"));

  // --- the command palette ---------------------------------------------------------
  const palette = h("dialog", { class: "palette", "aria-label": "Commands" });
  const palInput = h("input", { type: "text", placeholder: "Jump to a question, or run a command…", "aria-label": "Command" });
  const palList = h("div", { class: "results", role: "listbox" });
  palette.append(palInput, palList);
  let palItems = [];
  let palAt = 0;
  function commands() {
    const out = [];
    qs.forEach((q, i) => shownQ(q) && out.push({ t: `${i + 1}. ${q.text}`, s: stateOf(q) || "open", run: () => go(q.id, true) }));
    if (qs.some((q) => recs(q).length)) out.push({ t: "Take all recommendations", k: "⇧R", run: takeAll });
    if (shared) for (const o of shared.options) out.push({ t: `Mark every open as ${o.label}`, run: () => markAs(o) });
    out.push({ t: "Select all, or none", k: "⇧X", run: selectAll });
    if (!pages && !table) out.push({ t: "Expand all", k: "E", run: () => setFold("none") }, { t: "Collapse all", k: "⇧E", run: () => setFold("all") }, { t: "Fold answered questions", run: () => setFold("auto") });
    out.push({ t: "Send", k: "Ctrl ↵", run: trySend }, { t: "Next open question", k: "↵", run: nextOpen }, { t: "Undo", k: "Ctrl Z", run: undo }, { t: "Copy answers", run: () => copyAnswers() }, ...(historyOn ? [{ t: "Earlier answers", run: () => showHistory() }] : []), { t: "Keyboard shortcuts", k: "?", run: () => keysDialog.showModal() });
    const c = L.choices();
    if (c.desktop) out.push({ t: `Theme: your Claude Desktop theme (${c.desktop})`, run: () => L.set({ theme: "desktop" }) });
    for (const p of c.palettes) out.push({ t: `Theme: ${p.name}`, s: "Claude Desktop", run: () => L.set({ theme: `cd:${p.id}` }) });
    for (const k of c.kit) out.push({ t: `Theme: ${k.name}`, s: "kit", run: () => L.set({ theme: k.id }) });
    out.push({ t: "Accent: the theme's own", run: () => L.set({ accent: "" }) });
    for (const a of c.accents) out.push({ t: `Accent: ${a.name}`, run: () => L.set({ accent: a.id }) });
    for (const s of c.sizes) out.push({ t: `Text size: ${s.name}`, run: () => L.set({ size: s.id }) });
    out.push({ t: "Light", run: () => L.set({ mode: "light" }) }, { t: "Dark", run: () => L.set({ mode: "dark" }) }, { t: "Follow the system's light or dark", run: () => L.set({ mode: "auto" }) });
    for (const [v, n] of [["sections", "Sections: each section one panel"], ["cards", "Cards: each question its own panel"], ["lines", "Lines: a rule between questions"], ["bands", "Bands: alternating shades"]]) out.push({ t: `Separation: ${n}`, run: () => L.set({ sep: v }) });
    out.push({ t: "Density: Comfortable", run: () => L.set({ density: "comfortable" }) }, { t: "Density: Compact", run: () => L.set({ density: "compact" }) });
    for (const i of inbox.filter((x) => x.href !== here && x.state !== "answered")) out.push({ t: `Ask: ${i.title}`, s: `${i.asker?.project || i.project} · ${ago(i.asked)}`, run: () => location.assign(i.href) });
    return out;
  }
  function palDraw() {
    const words = palInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    palItems = commands().filter((c) => words.every((w) => c.t.toLowerCase().includes(w))).slice(0, 40);
    palAt = Math.min(palAt, Math.max(0, palItems.length - 1));
    palList.replaceChildren(...palItems.map((c, i) => h("button", { class: `item ${i === palAt ? "on" : ""}`, type: "button", role: "option", "aria-selected": String(i === palAt), onclick: () => palRun(i) }, h("span", { class: "t" }, c.t), c.s ? h("span", { class: "s" }, c.s) : null, c.k ? h("kbd", null, c.k) : null)));
    palList.children[palAt]?.scrollIntoView({ block: "nearest" });
  }
  function palRun(i) { const c = palItems[i]; palette.close(); c?.run(); }
  palInput.addEventListener("input", () => { palAt = 0; palDraw(); });
  palInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palAt = Math.min(palItems.length - 1, palAt + 1); palDraw(); }
    if (e.key === "ArrowUp") { e.preventDefault(); palAt = Math.max(0, palAt - 1); palDraw(); }
    if (e.key === "Enter") { e.preventDefault(); palRun(palAt); }
  });
  function openPalette() { palInput.value = ""; palAt = 0; palDraw(); palette.showModal(); palInput.focus(); }

  // --- the keyboard --------------------------------------------------------------
  const KEYS = [
    ["J / K", "Next or previous question"], ["↑ ↓", "Move between options"], ["1–9", "Pick that option (0: something else)"], ["R", "Take the recommendation"], ["⇧R", "Take all recommendations"],
    ["D / L", "You decide / Later"], ["E / ⇧E", "Expand all / collapse all"], ["⇧X", "Select all, or none"], ["N", "Write a note"], ["Enter", "Next open question"], ["X", "Select for a bulk answer"],
    ["← →", pages ? "Previous or next frame" : "Move the swipe line (in a compare)"], ["G", "All frames at once"], ["C", "Comment mode on a picture"], ["M", "Next compare view"], ["Z", "Zoom: fit, 100%, 200%"],
    ["[ / ]", "Previous or next waiting ask"], ["I", "The inbox of every ask"], ["Ctrl K", "Commands and questions"], ["Ctrl Z", "Undo (Ctrl ⇧Z redo)"], ["Ctrl Enter", "Send"], ["?", "This list"], ["Esc", "Leave a field, or close"],
  ];
  const keysDialog = h("dialog", { class: "keys", "aria-label": "Keyboard shortcuts" }, h("h2", null, "Keyboard"), h("table", null, h("tbody", null, KEYS.map(([k, t]) => h("tr", null, h("td", null, h("kbd", null, k)), h("td", null, t))))), h("p", { class: "muted small keys-foot" }, "Keys work when no text field has focus; Esc leaves one."));
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); if (panel) panel.querySelector(".btn.primary").click(); else trySend(); return; }
    if (mod && (e.key === "k" || e.key === "K")) { if (off.has("palette")) return; e.preventDefault(); openPalette(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !["checkbox", "radio", "range"].includes(e.target.type);
    if (e.key === "Escape") { if (openPop) { closePop(); return; } if (panel) { panel.remove(); panel = null; return; } if (typing) { e.target.blur(); uis.get(current)?.el.focus({ preventScroll: true }); } return; }
    if (mod && (e.key === "z" || e.key === "Z") && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (typing || mod || e.altKey || document.querySelector("dialog[open]")) return;
    document.body.classList.add("keys");
    if (receiptShown) { if (e.key === "Enter") { const n = nextAsk(); if (n) location.assign(n.href); } return; }
    if (panel && e.key === "Enter") { e.preventDefault(); panel.querySelector(".btn.primary").click(); return; }
    const ui = uis.get(current) ?? uis.get(qs[0]?.id) ?? {};
    const k = e.key;
    const keyMap = {
      j: () => step(1), k: () => step(-1), J: () => step(1), K: () => step(-1),
      r: () => { if (ui.takeRec && !ui.takeRec()) toast("This question has no recommendation."); }, R: () => !off.has("bulk") && takeAll(),
      d: () => ui.decide?.("agent"), l: () => ui.decide?.("later"), n: () => ui.focusNote?.(),
      x: () => { if (ui.selBox) select(ui.q.id, !selected.has(ui.q.id)); }, X: () => !off.has("bulk") && selectAll(),
      e: () => !pages && !table && setFold("none"), E: () => !pages && !table && setFold("all"),
      c: () => ui.toggleComment?.(), m: () => !off.has("compare") && ui.cycleCompare?.(), g: () => pages && toggleGrid(),
      z: () => setZoom({ fit: "1", 1: "2", 2: "fit" }[zoom]),
      "[": () => { const p = prevAsk(); if (p) location.assign(p.href); }, "]": () => { const n = nextAsk(); if (n) location.assign(n.href); else toast("No other ask is waiting."); },
      i: () => served && location.assign("/"), "?": () => keysDialog.showModal(),
      Enter: () => { if (e.target.closest?.("button, a, summary, .folded")) return false; nextOpen(); },
      ArrowRight: () => (pages ? showPage(pageIndex + 1) : false), ArrowLeft: () => (pages ? showPage(pageIndex - 1) : false),
      ArrowDown: () => (e.target.closest?.(".opt, ol.rank, .over") ? false : step(1)), ArrowUp: () => (e.target.closest?.(".opt, ol.rank, .over") ? false : step(-1)),
    };
    if (/^[0-9]$/.test(k)) { e.preventDefault(); ui.pick?.(Number(k)); return; }
    const run = keyMap[k];
    if (run && run() !== false) e.preventDefault();
  });

