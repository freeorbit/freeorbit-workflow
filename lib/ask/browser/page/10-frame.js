// The ask page in the browser. It draws the spec's questions in one layout
// for every template (a header with progress, a column of questions, and a
// footer to send), keeps a draft in this browser, and sends the answers to
// the shared question-pictures server; offline it copies them or saves a
// file for `wf ask import`. Colours are Claude Desktop's tokens, from the
// kit's themes or the Claude Desktop theme the server reads.
(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("ask-data").textContent);
  const { spec, kinds } = data;
  const qs = spec.questions;
  const key = data.key ?? "";
  const token = document.querySelector('meta[name="wf-token"]')?.content ?? "";
  const served = !data.offline && /^https?:$/.test(location.protocol) && token && !token.startsWith("__WF_ASK");
  const pages = spec.layout === "pages";
  const table = spec.layout === "table";
  // What this page leaves out: block kinds are dropped when it is built; these are features it draws without.
  const off = new Set(spec.off ?? []);
  document.documentElement.dataset.off = [...off].join(" ");
  // A page without pins draws no comment mode on any picture.
  if (off.has("pins")) for (const q of qs) q.pins = false;
  const app = document.getElementById("app");
  document.documentElement.dataset.layout = spec.layout;

  // --- small helpers ---------------------------------------------------
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
      else if (k === "class") node.className = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return node;
  }
  const local = window.wfAskShared.store;
  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) ?? "null"); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* nothing kept */ } },
  };
  const colour = (kind) => kinds[kind]?.color ?? "hsl(var(--accent-000))";
  const GLYPH = { ok: "✓", bug: "●", drift: "≈", look: "?", new: "✦" };
  const { clock, ago, askerLabel } = window.wfAskShared;
  const S = window.wfAskState;
  const M = window.wfMotion;
  const recs = S.recs;
  const optLabel = (q, id) => (id === "other" ? "Something else" : q.options.find((o) => o.id === id)?.label ?? id);

  // --- the look: the shared look.js keeps theme, accent, mode, density, size ---
  const L = window.wfLook;
  const look = L.look;
  L.init(data.themes, served);
  L.onChange(() => settingsRefresh());

  // --- answers, the draft, and undo --------------------------------------
  const draftKey = `wf-ask:${key}:${spec.id}:${spec.hash}`;
  const draft = local.get(draftKey);
  const A = structuredClone(draft?.answers ?? data.previous?.answers ?? {});
  const answered = S.answered;
  const byId = new Map(qs.map((q) => [q.id, q]));
  // A follow-up whose earlier answer does not fit is not asked: it is neither shown nor open.
  const shownQ = (q) => S.shown(q, A, byId);
  const live = () => qs.filter(shownQ);
  const isOpen = (q) => shownQ(q) && !answered(A[q.id], q);
  const entry = (id) => (A[id] ??= {});
  let savedAt = draft?.at ? new Date(draft.at) : null;
  let saveTimer = null;
  function persist() {
    S.prune(A);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      savedAt = new Date();
      if (receiptShown) return;
      const ok = local.set(draftKey, { at: savedAt.toISOString(), answers: A });
      savedLine(ok);
    }, 250);
  }
  const history = new S.History(20);
  let lastTextUndo = 0;
  function snapshot(text = false) {
    // Typing makes one step per pause, not one per key.
    if (text && Date.now() - lastTextUndo < 1500) { lastTextUndo = Date.now(); return; }
    if (text) lastTextUndo = Date.now();
    history.push(A);
  }
  function restore(then) {
    for (const k of Object.keys(A)) delete A[k];
    Object.assign(A, then);
    persist();
    qs.forEach((q) => uis.get(q.id)?.sync());
    refresh();
  }
  function undo() {
    const then = history.undo(A);
    if (!then) return toast("Nothing to undo.");
    restore(then);
    toast("Undone.", "Redo", redo);
  }
  function redo() {
    const then = history.redo(A);
    if (then) restore(then);
  }
  function changed(id) {
    persist();
    uis.get(id)?.sync();
    // Follow-ups may come or go with this answer.
    for (const q of qs) if (q.showIf && q.id !== id) uis.get(q.id)?.sync();
    refresh();
    if (sent) sendState("changed");
  }

  // --- the frame: header, rail, content, footer --------------------------
  const uis = new Map();
  let current = null;
  let sent = false;
  const savedEl = h("span", { class: "saved", role: "status", "aria-live": "polite" });
  const sentEl = h("span", { class: "saved", role: "status", "aria-live": "polite", hidden: true });
  function savedLine(ok = true) {
    savedEl.hidden = false;
    savedEl.className = `saved ${ok ? "on" : "err"}`;
    savedEl.textContent = ok ? (savedAt ? `Draft saved · ${clock(savedAt)}` : "Draft kept here") : "Draft not kept (private window?)";
  }
  savedLine(true);
  if (!savedAt) savedEl.hidden = true;
  const progressPill = h("button", { class: "pill num", type: "button", "aria-haspopup": "true", title: off.has("outline") ? "" : "Questions", onclick: (e) => { if (!off.has("outline")) outlinePop(e.currentTarget); } });
  const progressBar = h("i");
  const asksBox = h("span", { class: "asks", hidden: true });
  const menuBtn = h("button", { class: "btn icon", type: "button", "aria-label": "Settings", title: "Theme, density, and keys", onclick: (e) => settingsPop(e.currentTarget) }, "⋯");
  const who = spec.asker ? askerLabel(spec.asker) : "";
  const header = h("header", { class: "top" },
    h("div", { class: "row" },
      h("div", { class: "titles" }, h("h1", { title: spec.title }, spec.title), who || served ? h("div", { class: "who" }, who ? `Asked from ${who}` : "", served ? [who ? " · " : "", h("a", { href: "/" }, "All asks")] : null) : null),
      sentEl, savedEl, asksBox, progressPill, menuBtn),
    h("div", { class: "bar", "aria-hidden": "true" }, progressBar));
  const rail = h("nav", { class: "rail outline", "aria-label": "Questions" });
  const content = h("main", { class: "content", id: "content" });
  const statusEl = h("span", { class: "status num grow", "aria-live": "polite" });
  const selbar = h("div", { class: "selbar grow", hidden: true });
  const takeAllBtn = h("button", { class: "btn", type: "button", title: "Take all recommendations (⇧R)", onclick: () => takeAll() }, h("span", { class: "long" }, "Take all recommendations"), h("span", { class: "short" }, "Take all"), h("kbd", { class: "hint" }, "⇧R"));
  const markOpenBtn = h("button", { class: "btn", type: "button", onclick: (e) => markPop(e.currentTarget) }, h("span", { class: "long" }, "Mark open as…"), h("span", { class: "short" }, "Mark…"));
  const sendBtn = h("button", { class: "btn primary", type: "button", onclick: () => trySend() }, "Send", h("kbd", null, "Ctrl ↵"));
  const footer = h("footer", { class: "commit" }, h("div", { class: "row" }, statusEl, selbar, takeAllBtn, markOpenBtn, sendBtn));
  const toastEl = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  app.append(header, h("div", { class: "shell" }, rail, content), footer, toastEl);

  // --- toast --------------------------------------------------------------
  let toastTimer = null;
  function toast(text, action, run) {
    toastEl.replaceChildren(...[h("span", null, text), action ? h("button", { type: "button", onclick: () => { toastEl.classList.remove("on"); run(); } }, action) : null].filter(Boolean));
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("on"), action ? 7000 : 3200);
  }
  toastEl.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  toastEl.addEventListener("mouseleave", () => { toastTimer = setTimeout(() => toastEl.classList.remove("on"), 3000); });

  // --- popovers ------------------------------------------------------------
  let openPop = null;
  function closePop() { const pop = openPop; openPop = null; if (pop) M.leave(pop, () => pop.remove()); }
  function popAt(anchor, ...kids) {
    closePop();
    const pop = h("div", { class: "pop", role: "dialog" }, ...kids);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.top = `${Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    if (r.bottom > innerHeight - 120) pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 6)}px`;
    openPop = pop;
    pop.querySelector("button, a, select, input")?.focus();
    return pop;
  }
  document.addEventListener("mousedown", (e) => { if (openPop && !openPop.contains(e.target)) closePop(); });

  // --- the outline: rail on wide windows, popover from the count ----------
  function stateOf(q) {
    const v = A[q.id];
    if (v?.decide === "later") return "later";
    if (v?.decide === "agent") return "agent";
    return answered(v, q) ? "done" : "";
  }
  function outlineLinks() {
    const out = [];
    let group = null;
    qs.forEach((q, i) => {
      if (!shownQ(q)) return;
      const g = q.table || q.group;
      if (g && g !== group) { out.push(h("div", { class: "g" }, g)); group = g; }
      out.push(h("a", { href: `#q-${q.id}`, class: current === q.id ? "on" : "", onclick: (e) => { e.preventDefault(); closePop(); go(q.id, true); } }, h("span", { class: `dot ${stateOf(q)}` }), h("span", { class: "t" }, `${i + 1}. ${q.text}`)));
    });
    return out;
  }
  function outlinePop(anchor) { popAt(anchor, h("div", { class: "outline" }, outlineLinks())); }
  function railRefresh() { rail.replaceChildren(h("div", { class: "outline" }, outlineLinks())); }

  // --- settings -----------------------------------------------------------
  let settingsRefresh = () => {};
  function settingsPop(anchor) {
    const seg = (pairs, value, set) => h("div", { class: "seg" }, pairs.map(([v, label]) => h("button", { type: "button", "aria-pressed": String(value === v), onclick: (e) => { set(v); e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, label)));
    const themeSel = h("select", { class: "pick theme-pick", "aria-label": "Theme", onchange: (e) => L.set({ theme: e.target.value }) });
    const swatches = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Accent colour" });
    const custom = h("input", { type: "color", class: "custom-accent", "aria-label": "A colour of your own", title: "A colour of your own", oninput: (e) => L.set({ accent: e.target.value }) });
    const fill = () => {
      const c = L.choices();
      const groups = [];
      if (c.desktop || c.palettes.length) {
        const g = h("optgroup", { label: "Claude Desktop" });
        if (c.desktop) g.append(h("option", { value: "desktop" }, `Yours: ${c.desktop}`));
        for (const p of c.palettes) g.append(h("option", { value: `cd:${p.id}` }, p.name));
        groups.push(g);
      }
      const kitGroup = h("optgroup", { label: "The kit" });
      for (const k of c.kit) kitGroup.append(h("option", { value: k.id }, k.name));
      groups.push(kitGroup);
      themeSel.replaceChildren(...groups);
      themeSel.value = c.current;
      const mode = document.documentElement.dataset.mode;
      swatches.replaceChildren(
        h("button", { type: "button", class: "swatch-btn own", role: "radio", "aria-checked": String(!look.accent), title: "The theme's own accent", onclick: () => L.set({ accent: "" }) }, "Auto"),
        ...c.accents.map((a) => h("button", { type: "button", class: "swatch-btn", role: "radio", "aria-checked": String(look.accent === a.id), title: a.name, "aria-label": a.name, style: { "--sw": `hsl(${mode === "dark" ? a.dark : a.light})` }, onclick: () => L.set({ accent: a.id }) })),
        custom);
      if (/^#/.test(look.accent)) custom.value = look.accent;
      custom.classList.toggle("on", /^#/.test(look.accent));
    };
    fill();
    settingsRefresh = () => { if (themeSel.isConnected) fill(); };
    popAt(anchor,
      h("div", { class: "h" }, "Look"),
      h("div", { class: "field" }, "Theme", themeSel),
      h("div", { class: "field col" }, "Accent", swatches),
      h("div", { class: "field" }, "Light or dark", seg([["auto", "System"], ["light", "Light"], ["dark", "Dark"]], look.mode, (v) => L.set({ mode: v }))),
      h("div", { class: "field" }, "Text size", seg(L.choices().sizes.map((s) => [s.id, s.id === "m" ? "A" : s.id === "s" ? "A−" : s.id === "l" ? "A+" : "A++"]), look.size, (v) => L.set({ size: v }))),
      h("div", { class: "field" }, "Density", seg([["comfortable", "Comfortable"], ["compact", "Compact"]], look.density, (v) => L.set({ density: v }))),
      off.has("motion") ? null : h("div", { class: "field col", title: "System follows your computer's setting for less motion. Full: things glide and draw in. Subtle: fades only. Off: no motion." }, "Motion", seg([["system", matchMedia("(prefers-reduced-motion: reduce)").matches ? "System (off)" : "System"], ["full", "Full"], ["subtle", "Subtle"], ["off", "Off"]], look.motion, (v) => L.set({ motion: v }))),
      pages || table ? null : h("div", { class: "field col" }, "Separation", seg([["sections", "Sections"], ["cards", "Cards"], ["lines", "Lines"], ["bands", "Bands"]], look.sep, (v) => L.set({ sep: v }))),
      pages ? h("div", { class: "h" }, "Review") : null,
      pages ? h("label", { class: "field switch" }, "Next frame after a verdict", h("input", { type: "checkbox", checked: look.advance, onchange: (e) => L.set({ advance: e.target.checked }) })) : null,
      notifyField(),
      h("div", { class: "h" }, "More"),
      historyOn ? h("button", { class: "item", type: "button", onclick: () => { closePop(); showHistory(); } }, h("span", { class: "t" }, "Earlier answers")) : null,
      h("button", { class: "item", type: "button", onclick: () => { closePop(); keysDialog.showModal(); } }, h("span", { class: "t" }, "Keyboard shortcuts"), h("kbd", null, "?")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); copyAnswers(); } }, h("span", { class: "t" }, "Copy answers")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); downloadAnswers(); } }, h("span", { class: "t" }, "Save answers file")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); print(); } }, h("span", { class: "t" }, "Print")),
      h("button", { class: "item", type: "button", title: "The look, folding, zoom, compare view, inbox filters, and notifications, back to how they start", onclick: () => { closePop(); resetSettings(); } }, h("span", { class: "t" }, "Reset settings")));
  }

  /**
   * Every setting back to how it starts: the look, folding, zoom, compare view,
   * the inbox's filters, and notifications. They are kept until then; Undo
   * brings them back.
   */
  function resetSettings() {
    const before = { look: { ...look }, inbox: local.get("wf-ask:inbox"), notify: local.get("wf-ask:notify") };
    const fresh = () => { foldMode = look.fold; setZoom(look.zoom); qs.forEach((q) => { const u = uis.get(q.id); if (u) { u.unfold = false; u.sync(); } }); toolbarRefresh(); settingsRefresh(); };
    L.reset();
    local.drop("wf-ask:inbox");
    window.wfAskShared.notifier.disable();
    fresh();
    toast("Every setting is back to how it starts.", "Undo", () => {
      L.set(before.look);
      if (before.inbox) local.set("wf-ask:inbox", before.inbox);
      if (before.notify != null) local.set("wf-ask:notify", before.notify);
      fresh();
    });
  }

