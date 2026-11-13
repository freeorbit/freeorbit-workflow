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
  const local = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    drop(k) { try { localStorage.removeItem(k); } catch { /* nothing kept */ } },
  };
  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) ?? "null"); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* nothing kept */ } },
  };
  const colour = (kind) => kinds[kind]?.color ?? "hsl(var(--accent-000))";
  const GLYPH = { ok: "✓", bug: "●", drift: "≈", look: "?", new: "✦" };
  const clock = (d = new Date()) => d.toTimeString().slice(0, 5);
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  };
  const optLabel = (q, id) => (id === "other" ? "Something else" : q.options.find((o) => o.id === id)?.label ?? id);
  const recs = (q) => (Array.isArray(q.recommended) ? q.recommended : q.recommended != null ? [q.recommended] : []);

  // --- the look: the shared look.js keeps theme, accent, mode, density, size ---
  const L = window.wfLook;
  const look = L.look;
  L.init(data.themes, served);
  L.onChange(() => settingsRefresh());

  // --- answers, the draft, and undo --------------------------------------
  const draftKey = `wf-ask:${key}:${spec.id}:${spec.hash}`;
  const draft = local.get(draftKey);
  const A = structuredClone(draft?.answers ?? data.previous?.answers ?? {});
  const answered = (v) => Boolean(v && (v.choice != null || v.order || v.text || v.decide || v.other));
  const isOpen = (q) => !answered(A[q.id]);
  const entry = (id) => (A[id] ??= {});
  let savedAt = draft?.at ? new Date(draft.at) : null;
  let saveTimer = null;
  function persist() {
    for (const [id, v] of Object.entries(A)) {
      for (const k of Object.keys(v)) if (v[k] == null || v[k] === "" || (Array.isArray(v[k]) && !v[k].length)) delete v[k];
      if (!Object.keys(v).length) delete A[id];
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      savedAt = new Date();
      if (receiptShown) return;
      const ok = local.set(draftKey, { at: savedAt.toISOString(), answers: A });
      savedLine(ok);
    }, 250);
  }
  const undoStack = [];
  const redoStack = [];
  let lastTextUndo = 0;
  function snapshot(text = false) {
    // Typing makes one step per pause, not one per key.
    if (text && Date.now() - lastTextUndo < 1500) { lastTextUndo = Date.now(); return; }
    if (text) lastTextUndo = Date.now();
    undoStack.push(JSON.stringify(A));
    if (undoStack.length > 20) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(json) {
    for (const k of Object.keys(A)) delete A[k];
    Object.assign(A, JSON.parse(json));
    persist();
    qs.forEach((q) => uis.get(q.id)?.sync());
    refresh();
  }
  function undo() {
    if (!undoStack.length) return toast("Nothing to undo.");
    redoStack.push(JSON.stringify(A));
    restore(undoStack.pop());
    toast("Undone.", "Redo", redo);
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(A));
    restore(redoStack.pop());
  }
  function changed(id) {
    persist();
    uis.get(id)?.sync();
    refresh();
    if (sent) sendState("changed");
  }

  // --- the frame: header, rail, content, footer --------------------------
  const uis = new Map();
  let current = null;
  let sent = false;
  const savedEl = h("span", { class: "saved", role: "status", "aria-live": "polite" });
  function savedLine(ok = true) {
    savedEl.hidden = false;
    savedEl.className = `saved ${ok ? "on" : "err"}`;
    savedEl.textContent = ok ? (savedAt ? `Draft saved · ${clock(savedAt)}` : "Draft kept here") : "Draft not kept (private window?)";
  }
  savedLine(true);
  if (!savedAt) savedEl.hidden = true;
  const progressPill = h("button", { class: "pill num", type: "button", "aria-haspopup": "true", title: "Questions (Ctrl+K)", onclick: (e) => outlinePop(e.currentTarget) });
  const progressBar = h("i");
  const asksBox = h("span", { class: "asks", hidden: true });
  const menuBtn = h("button", { class: "btn icon", type: "button", "aria-label": "Settings", title: "Theme, density, and keys", onclick: (e) => settingsPop(e.currentTarget) }, "⋯");
  const who = spec.asker ? [spec.asker.project, spec.asker.worktree || spec.asker.branch, spec.asker.session ? `session ${spec.asker.session.replace(/^local_/, "").slice(0, 8)}` : ""].filter(Boolean).join(" · ") : "";
  const header = h("header", { class: "top" },
    h("div", { class: "row" },
      h("div", { class: "titles" }, h("h1", { title: spec.title }, spec.title), who || served ? h("div", { class: "who" }, who ? `Asked from ${who}` : "", served ? [who ? " · " : "", h("a", { href: "/" }, "All asks")] : null) : null),
      savedEl, asksBox, progressPill, menuBtn),
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
  function closePop() { openPop?.remove(); openPop = null; }
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
    return answered(v) ? "done" : "";
  }
  function outlineLinks() {
    const out = [];
    let group = null;
    qs.forEach((q, i) => {
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
    const themeSel = h("select", { class: "pick", "aria-label": "Theme", style: { "max-width": "210px" }, onchange: (e) => L.set({ theme: e.target.value }) });
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
      pages || table ? null : h("div", { class: "field col" }, "Separation", seg([["cards", "Cards"], ["sections", "Sections"], ["lines", "Lines"], ["bands", "Bands"]], look.sep, (v) => L.set({ sep: v }))),
      pages ? h("div", { class: "h" }, "Review") : null,
      pages ? h("label", { class: "field switch" }, "Next frame after a verdict", h("input", { type: "checkbox", checked: look.advance, onchange: (e) => L.set({ advance: e.target.checked }) })) : null,
      h("div", { class: "h" }, "More"),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); keysDialog.showModal(); } }, h("span", { class: "t" }, "Keyboard shortcuts"), h("kbd", null, "?")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); copyAnswers(); } }, h("span", { class: "t" }, "Copy answers")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); downloadAnswers(); } }, h("span", { class: "t" }, "Save answers file")),
      h("button", { class: "item", type: "button", onclick: () => { closePop(); print(); } }, h("span", { class: "t" }, "Print")));
  }

  // --- pictures: stage, boxes, pins, comment mode ----------------------------
  const full = h("dialog", { onclick: () => full.close() }, h("img", { class: "dialog-img", alt: "" }));
  function showFull(pic) { full.querySelector("img").src = pic.src; full.querySelector("img").alt = pic.name || pic.label || "picture"; full.showModal(); }
  let zoom = session.get("wf-ask:zoom") ?? "fit";
  const stages = new Set();
  function stage(q, pic, index, pinnable) {
    const img = h("img", { src: pic.src, alt: pic.name || pic.label || `picture ${index + 1}`, draggable: "false", decoding: "async", width: pic.w || null, height: pic.h || null });
    const node = h("div", { class: "stage" }, img);
    if (pic.w && pic.h) node.style.aspectRatio = `${pic.w} / ${pic.h}`;
    const size = () => [pic.w || img.naturalWidth || 1, pic.h || img.naturalHeight || 1];
    node.place = () => {
      const [w, ht] = size();
      node.querySelectorAll(".box,.pin").forEach((e) => e.remove());
      for (const box of pic.boxes ?? []) {
        const [x, y, bw, bh] = box.rect;
        node.append(h("div", { class: "box", title: box.text || box.kind, style: { left: `${(x / w) * 100}%`, top: `${(y / ht) * 100}%`, width: `${(bw / w) * 100}%`, height: `${(bh / ht) * 100}%`, "--c": colour(box.kind) } }, h("span", null, box.n)));
      }
      (A[q.id]?.pins ?? []).forEach((pin, i) => {
        if (pin.picture === index) node.append(h("div", { class: "pin", "data-pin": i, title: pin.text, style: { left: `${(pin.x / w) * 100}%`, top: `${(pin.y / ht) * 100}%`, "--c": colour(pin.kind) } }, i + 1));
      });
    };
    node.zoom = () => { const [w, ht] = size(); node.style.setProperty("--w", zoom === "fit" ? `min(100%, calc(72vh * ${w} / ${ht}))` : `${w * Number(zoom)}px`); };
    if (pic.w && pic.h) node.place(); else img.addEventListener("load", node.place, { once: true });
    node.zoom();
    stages.add(node);
    if (pinnable) {
      node.addEventListener("click", (event) => {
        if (!uis.get(q.id)?.commenting) return;
        const r = img.getBoundingClientRect();
        const [w, ht] = size();
        const x = ((event.clientX - r.left) / r.width) * w;
        const y = ((event.clientY - r.top) / r.height) * ht;
        const box = (pic.boxes ?? []).find((b) => x >= b.rect[0] && x <= b.rect[0] + b.rect[2] && y >= b.rect[1] && y <= b.rect[1] + b.rect[3]);
        uis.get(q.id)?.askPin({ picture: index, x: Math.round(x), y: Math.round(y), ...(box ? { box: box.n } : {}) });
      });
    }
    return node;
  }
  function setZoom(next) {
    zoom = next;
    session.set("wf-ask:zoom", zoom);
    stages.forEach((s) => s.isConnected && s.zoom());
    document.querySelectorAll("select.zoom").forEach((s) => { s.value = zoom; });
  }
  const zoomSelect = () => h("select", { class: "pick zoom", "aria-label": "Zoom", onchange: (e) => setZoom(e.target.value) }, [["fit", "Fit"], ["1", "100%"], ["2", "200%"]].map(([v, l]) => h("option", { value: v, selected: zoom === v }, l)));

  // A viewer: one or more pictures, or a compare pair, with its bar.
  function viewer(q, ui) {
    const all = [...q.pictures, ...(q.compare ?? [])];
    const bar = h("div", { class: "vbar" });
    const body = h("div", { class: "stage-wrap" });
    const box = h("div", { class: "viewer" }, bar, body);
    const commentBtn = q.pins ? h("button", { class: "ghost", type: "button", "aria-pressed": "false", onclick: () => ui.toggleComment() }, "Comment", h("kbd", { class: "hint" }, "C")) : null;
    if (q.compare) {
      const [a, b] = q.compare;
      const la = a.label || "First";
      const lb = b.label || "Second";
      const left = stage(q, a, q.pictures.length, q.pins);
      const right = stage(q, b, q.pictures.length + 1, q.pins);
      const tagged = (s, label) => h("div", { class: "tagged" }, h("span", { class: "tag l" }, label), s);
      const pair = h("div", { class: "pair" }, tagged(left, la), tagged(right, lb));
      const base = stage(q, b, q.pictures.length + 1, false);
      const top = stage(q, a, q.pictures.length, false);
      top.classList.add("top");
      const over = h("div", { class: "over swipe", tabindex: "0", "aria-label": `${la} over ${lb}; left and right arrows move the line` }, base, top, h("div", { class: "divider" }, h("span", { class: "grip" }, "⇆")), h("span", { class: "tag l" }, la), h("span", { class: "tag r" }, lb));
      const slider = h("input", { type: "range", min: "0", max: "100", step: "0.5", value: "50", "aria-label": `How much of ${la} shows` });
      const at = (v) => { v = Math.max(0, Math.min(100, v)); slider.value = String(v); over.style.setProperty("--at", `${v}%`); over.style.setProperty("--op", String(v / 100)); };
      slider.addEventListener("input", () => at(Number(slider.value)));
      at(50);
      let drag = false;
      const follow = (e) => { const r = over.getBoundingClientRect(); at(((e.clientX - r.left) / r.width) * 100); };
      over.addEventListener("pointerdown", (e) => { if (mode !== "swipe") return; drag = true; over.setPointerCapture(e.pointerId); follow(e); });
      over.addEventListener("pointermove", (e) => { if (drag) requestAnimationFrame(() => follow(e)); });
      over.addEventListener("pointerup", () => { drag = false; });
      over.addEventListener("pointercancel", () => { drag = false; });
      over.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); at(Number(slider.value) + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 5)); }
      });
      const sizeA = a.w && a.h ? `${a.w}×${a.h}` : "";
      const sizeB = b.w && b.h ? `${b.w}×${b.h}` : "";
      const sizeNote = sizeA && sizeB ? h("span", { class: `size num ${sizeA !== sizeB ? "diff" : ""}`, title: sizeA !== sizeB ? "The sizes differ; the pictures are lined up at the top left." : "Both pictures are the same size." }, sizeA === sizeB ? sizeA : `${la} ${sizeA} · ${lb} ${sizeB}`) : null;
      let mode = session.get("wf-ask:compare") ?? "side";
      const modes = [["side", "Side by side"], ["swipe", "Swipe"], ["onion", "Onion"], ["diff", "Difference"]];
      const seg = h("div", { class: "seg", role: "group", "aria-label": "How to compare" }, modes.map(([id, label]) => h("button", { type: "button", "data-mode": id, onclick: () => setMode(id) }, label)));
      const note = h("p", { class: "muted", style: { margin: "0 0 8px", "font-size": "12px" } });
      const notes = { swipe: `Drag across the picture, or focus it and use ← →. ${la} is left of the line.`, onion: `${la} faded over ${lb}; the slider sets how much.`, diff: "What is the same goes dark; what differs lights up." };
      function setMode(id) {
        mode = id;
        session.set("wf-ask:compare", mode);
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === mode)));
        pair.hidden = mode !== "side";
        over.hidden = mode === "side";
        slider.hidden = mode !== "swipe" && mode !== "onion";
        over.className = `over ${mode}`;
        note.hidden = mode === "side";
        note.textContent = mode === "side" ? "" : `${notes[mode]} Pins go on the side-by-side view.`;
        if (commentBtn) commentBtn.hidden = mode !== "side";
      }
      bar.append(...[seg, slider, sizeNote, h("span", { class: "grow" }), zoomSelect(), commentBtn].filter(Boolean));
      body.append(note, pair, over);
      setMode(mode);
      ui.cycleCompare = () => setMode(modes[(modes.findIndex(([id]) => id === mode) + 1) % modes.length][0]);
    } else {
      const figs = q.pictures.map((pic, i) => h("figure", { class: "pic" },
        h("figcaption", null, pic.label ? h("b", null, pic.label) : null, h("span", { class: "grow" }, pic.name || ""), pic.w ? h("span", { class: "num" }, `${pic.w}×${pic.h}`) : null, h("button", { class: "ghost", type: "button", onclick: () => showFull(pic) }, "Full size")),
        stage(q, pic, i, q.pins)));
      body.append(figs.length > 1 ? h("div", { class: "pair" }, figs) : figs[0]);
      bar.append(...[h("span", { class: "muted", style: { "font-size": "12px" } }, all.length > 1 ? `${all.length} pictures` : ""), h("span", { class: "grow" }), zoomSelect(), commentBtn].filter(Boolean));
    }
    ui.commentBtn = commentBtn;
    return box;
  }

  // --- one question ----------------------------------------------------------
  function question(q, number) {
    const ui = { q, commenting: false };
    uis.set(q.id, ui);
    const sec = h("section", { class: "q", id: `q-${q.id}`, tabindex: "-1", "aria-labelledby": `t-${q.id}`, "data-id": q.id });
    ui.el = sec;
    const selBox = q.type === "rank" ? null : h("input", { type: "checkbox", class: "sel", "aria-label": `Select question ${number} for a bulk answer`, onchange: (e) => select(q.id, e.target.checked) });
    ui.selBox = selBox;
    const body = h("div");
    const folded = h("div", { class: "folded", tabindex: "0", role: "button", onclick: () => open(), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } });
    const open = () => { ui.unfold = true; ui.sync(); go(q.id, true); };
    // The folded line and the body each sit in a wrapper that animates its height.
    const foldLine = h("div", { class: "fold-line" }, h("div", null, folded));
    const foldBody = h("div", { class: "fold-body" }, h("div", null, body));
    sec.append(
      h("div", { class: "q-head" }, selBox, h("h2", { id: `t-${q.id}` }, h("span", { class: "n" }, `${number}.`), q.text), q.role ? h("span", { class: "chip" }, q.role) : null),
      foldLine, foldBody);
    if (q.detail) body.append(h("p", { class: "q-sub" }, q.detail));
    if (q.look) body.append(h("p", { class: "look" }, h("b", null, "Where to look: "), q.look));
    if (q.pictures.length || q.compare) body.append(viewer(q, ui));

    // The answer.
    const rec = recs(q);
    const optEls = [];
    if (q.type === "one" || q.type === "many") {
      if (pages && q.options.every((o) => o.kind)) {
        // A review: verdict buttons under the picture, keys 1 to n.
        const bar = h("div", { class: "verdicts", role: q.type === "one" ? "radiogroup" : "group", "aria-label": q.text });
        q.options.forEach((o, i) => {
          const b = h("button", { type: "button", class: "verdict", "data-id": o.id, role: q.type === "one" ? "radio" : "checkbox", "aria-checked": "false", title: o.why || "", style: { "--c": colour(o.kind) }, onclick: () => ui.choose(o.id, true) }, h("span", null, GLYPH[o.kind] ?? "•"), h("span", { class: "l" }, o.label), i < 9 ? h("kbd", { class: "hint" }, i + 1) : null);
          optEls.push(b);
          bar.append(b);
        });
        (body.querySelector(".viewer") ?? body).append(bar);
      } else {
        const list = h("div", { class: `opts ${q.type === "many" ? "many" : ""} ${q.options.length > 5 ? "list" : ""}`, role: q.type === "one" ? "radiogroup" : "group", "aria-labelledby": `t-${q.id}` });
        const all = [...q.options, ...(q.other ? [{ id: "other", label: "Something else", why: "In your own words." }] : [])];
        all.forEach((o, i) => {
          const card = h("div", { class: "opt", role: q.type === "one" ? "radio" : "checkbox", "aria-checked": "false", tabindex: "-1", "data-id": o.id, onclick: () => ui.choose(o.id, true),
            onkeydown: (e) => {
              if (e.key === " ") { e.preventDefault(); ui.choose(o.id, true); }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault(); e.stopPropagation();
                const next = optEls[(i + (e.key === "ArrowDown" ? 1 : optEls.length - 1)) % optEls.length];
                next.focus();
                if (q.type === "one") ui.choose(next.dataset.id, true);
              }
            } },
            h("span", { class: "mark", "aria-hidden": "true" }),
            h("span", { class: "label" }, o.kind ? h("span", { class: "swatch", style: { background: colour(o.kind) } }) : null, o.label, rec.includes(o.id) ? h("span", { class: "badge" }, "Recommended") : null),
            i < 9 ? h("kbd", { class: "key hint" }, o.id === "other" ? "0" : i + 1) : null,
            o.why ? h("span", { class: "desc" }, o.why) : null,
            o.preview ? h("details", { class: "sketch", onclick: (e) => e.stopPropagation() }, h("summary", null, "Show sketch"), h("pre", null, o.preview)) : null);
          optEls.push(card);
          list.append(card);
        });
        body.append(list);
        if (q.other) {
          ui.otherInput = h("input", { type: "text", class: "other-text", placeholder: "Your own words", "aria-label": `Your own answer to ${q.text}`, hidden: true,
            oninput: (e) => { snapshot(true); entry(q.id).other = e.target.value; changed(q.id); } });
          body.append(ui.otherInput);
        }
      }
      if (q.noPick) body.append(h("p", { class: "why" }, h("b", null, "No recommendation: "), q.noPick));
      else if (q.why && rec.length) body.append(h("p", { class: "why" }, h("b", null, `Why ${rec.map((id) => optLabel(q, id)).join(", ")}: `), q.why));
      ui.choose = (id, user) => {
        snapshot();
        const v = entry(q.id);
        if (q.type === "one") v.choice = v.choice === id && !user ? undefined : id;
        else {
          const now = new Set(Array.isArray(v.choice) ? v.choice : []);
          now.has(id) ? now.delete(id) : now.add(id);
          v.choice = [...now];
        }
        delete v.decide;
        changed(q.id);
        if (id === "other" && ui.otherInput) { ui.otherInput.hidden = false; ui.otherInput.focus(); }
        if (user && pages && q.type === "one" && look.advance && optEls[0]?.classList.contains("verdict")) setTimeout(() => goNextPage(), 160);
      };
      ui.pick = (n) => {
        const target = n === 0 ? optEls.find((e) => e.dataset.id === "other") : optEls.filter((e) => e.dataset.id !== "other")[n - 1];
        if (target) { ui.choose(target.dataset.id, true); if (!pages) target.focus(); }
      };
      ui.setChoice = (ids) => {
        const v = entry(q.id);
        v.choice = q.type === "one" ? ids[0] : [...ids];
        delete v.decide;
      };
      ui.takeRec = () => { if (!rec.length) return false; snapshot(); ui.setChoice(rec); changed(q.id); return true; };
    } else if (q.type === "text") {
      const area = h("textarea", { rows: "3", "aria-labelledby": `t-${q.id}`, placeholder: "Your answer", oninput: (e) => { snapshot(true); entry(q.id).text = e.target.value; delete entry(q.id).decide; changed(q.id); } });
      ui.area = area;
      body.append(h("div", { class: "note" }, area));
      ui.pick = () => area.focus();
    } else if (q.type === "rank") {
      const list = h("ol", { class: "rank", "aria-label": "Order, first at the top. Alt and the up or down arrow move an item." });
      const order = () => A[q.id]?.order ?? q.options.map((o) => o.id);
      const move = (from, to) => {
        const now = [...order()];
        if (to < 0 || to >= now.length) return;
        snapshot();
        const [it] = now.splice(from, 1);
        now.splice(to, 0, it);
        entry(q.id).order = now;
        delete entry(q.id).decide;
        changed(q.id);
        list.children[to]?.focus();
      };
      let dragFrom = null;
      ui.drawRank = () => {
        list.replaceChildren(...order().map((id, i) => {
          const o = q.options.find((x) => x.id === id);
          const li = h("li", { tabindex: "0", draggable: "true", "aria-label": `${i + 1}. ${o.label}`,
            onkeydown: (e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); move(i, i + (e.key === "ArrowDown" ? 1 : -1)); } },
            ondragstart: () => { dragFrom = i; li.classList.add("dragging"); }, ondragend: () => li.classList.remove("dragging"),
            ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); if (dragFrom != null) move(dragFrom, i); dragFrom = null; } },
            h("span", { class: "handle", "aria-hidden": "true" }, "⋮⋮"), h("span", { class: "n" }, `${i + 1}`),
            h("span", { class: "grow" }, h("b", null, o.label), o.why ? h("div", { class: "muted", style: { "font-size": "13px" } }, o.why) : null),
            h("button", { class: "ghost", type: "button", "aria-label": `Move ${o.label} up`, onclick: () => move(i, i - 1), disabled: i === 0 }, "↑"),
            h("button", { class: "ghost", type: "button", "aria-label": `Move ${o.label} down`, onclick: () => move(i, i + 1), disabled: i === order().length - 1 }, "↓"));
          return li;
        }));
      };
      ui.drawRank();
      body.append(list);
      if (q.why) body.append(h("p", { class: "why" }, h("b", null, "Suggested order, as listed: "), q.why));
      ui.takeRec = () => { snapshot(); entry(q.id).order = q.options.map((o) => o.id); delete entry(q.id).decide; changed(q.id); return true; };
      ui.pick = () => list.children[0]?.focus();
    }

    // The quiet row.
    const meta = h("div", { class: "meta" });
    const deciders = [];
    if (q.defer) for (const [id, label, k] of [["agent", "You decide", "D"], ["later", "Later", "L"]]) {
      const b = h("button", { class: "ghost", type: "button", "aria-pressed": "false", onclick: () => ui.decide(id) }, label, h("kbd", { class: "hint" }, k));
      b.dataset.id = id;
      deciders.push(b);
      meta.append(b);
    }
    if (q.type === "rank") meta.append(h("button", { class: "ghost", type: "button", onclick: () => ui.takeRec() }, "This order is right", h("kbd", { class: "hint" }, "R")));
    const noteBtn = h("button", { class: "ghost", type: "button", onclick: () => ui.focusNote() }, "+ Note", h("kbd", { class: "hint" }, "N"));
    if (meta.childNodes.length) meta.append(h("span", { class: "sep" }));
    meta.append(noteBtn);
    const noteArea = h("textarea", { rows: "2", placeholder: "A note for the agent", "aria-label": `Note on ${q.text}`, oninput: (e) => { snapshot(true); entry(q.id).note = e.target.value; e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`; changed(q.id); } });
    const note = h("div", { class: "note", hidden: true }, noteArea);
    body.append(meta, note);
    ui.decide = (id) => {
      snapshot();
      const v = entry(q.id);
      v.decide = v.decide === id ? undefined : id;
      if (v.decide) { delete v.choice; delete v.order; delete v.text; delete v.other; }
      changed(q.id);
    };
    ui.focusNote = () => { note.hidden = false; noteArea.focus(); };

    // Pins.
    if (q.pins) {
      const pinList = h("ol", { class: "pins" });
      const kindSel = h("select", { class: "pick", "aria-label": "Kind of comment" }, Object.entries(kinds).map(([id, k]) => h("option", { value: id }, k.word)));
      kindSel.value = "bug" in kinds ? "bug" : Object.keys(kinds)[0];
      const pinText = h("input", { type: "text", placeholder: "What is here?", "aria-label": "Comment" });
      const form = h("div", { class: "pinform", hidden: true }, kindSel, pinText, h("button", { class: "btn primary", type: "button", onclick: () => add() }, "Add"), h("button", { class: "btn", type: "button", onclick: () => cancel() }, "Cancel"));
      let pending = null;
      const all = [...q.pictures, ...(q.compare ?? [])];
      const add = () => { if (!pending) return; snapshot(); const v = entry(q.id); v.pins = [...(v.pins ?? []), { ...pending, kind: kindSel.value, text: pinText.value.trim() }]; pending = null; form.hidden = true; pinText.value = ""; changed(q.id); };
      const cancel = () => { pending = null; form.hidden = true; };
      pinText.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); cancel(); } });
      ui.askPin = (at) => { pending = at; form.hidden = false; pinText.focus(); };
      ui.toggleComment = () => {
        ui.commenting = !ui.commenting;
        ui.commentBtn?.setAttribute("aria-pressed", String(ui.commenting));
        sec.querySelectorAll(".stage").forEach((s) => s.classList.toggle("commenting", ui.commenting));
        if (ui.commenting) toast("Comment mode: click the picture where something is wrong. C turns it off.");
      };
      ui.drawPins = () => {
        pinList.replaceChildren(...(A[q.id]?.pins ?? []).map((pin, i) => {
          const pic = all[pin.picture];
          return h("li", { onmouseenter: () => sec.querySelectorAll(`[data-pin="${i}"]`).forEach((p) => p.classList.add("hl")), onmouseleave: () => sec.querySelectorAll(".pin.hl").forEach((p) => p.classList.remove("hl")) },
            h("span", { class: "swatch", style: { background: colour(pin.kind) } }), " ", `${kinds[pin.kind]?.word ?? pin.kind} on ${pic?.label || pic?.name || "the picture"}${pin.box != null ? `, box ${pin.box}` : ""}: ${pin.text || "(no text)"}`,
            h("button", { class: "ghost", type: "button", "aria-label": `Remove comment ${i + 1}`, onclick: () => { snapshot(); A[q.id].pins.splice(i, 1); changed(q.id); } }, "Remove"));
        }));
      };
      (body.querySelector(".viewer") ?? body).append(form, pinList);
    }

    ui.sync = () => {
      const v = A[q.id];
      const picks = v?.choice == null ? [] : Array.isArray(v.choice) ? v.choice : [v.choice];
      optEls.forEach((e) => {
        const on = picks.includes(e.dataset.id);
        e.classList.toggle("on", on);
        e.setAttribute("aria-checked", String(on));
      });
      // Roving focus: the picked option, else the first, is the one Tab reaches.
      if (optEls.length && !optEls[0].classList.contains("verdict")) {
        const tabbable = optEls.find((e) => e.classList.contains("on")) ?? optEls[0];
        optEls.forEach((e) => e.setAttribute("tabindex", e === tabbable ? "0" : "-1"));
      }
      if (ui.otherInput) { ui.otherInput.hidden = !picks.includes("other"); if (ui.otherInput.value !== (v?.other ?? "")) ui.otherInput.value = v?.other ?? ""; }
      if (ui.area && ui.area.value !== (v?.text ?? "")) ui.area.value = v?.text ?? "";
      if (noteArea.value !== (v?.note ?? "")) noteArea.value = v?.note ?? "";
      if (v?.note) note.hidden = false;
      noteBtn.firstChild.textContent = v?.note ? "Note" : "+ Note";
      deciders.forEach((b) => b.setAttribute("aria-pressed", String(v?.decide === b.dataset.id)));
      ui.drawRank?.();
      ui.drawPins?.();
      sec.querySelectorAll(".stage").forEach((s) => s.place?.());
      // Answered questions fold to one line in a list, until opened.
      const fold = !pages && !ui.unfold && (foldMode === "all" || (foldMode === "auto" && answered(v) && current !== q.id));
      sec.classList.toggle("is-folded", fold);
      foldBody.inert = fold;
      foldLine.inert = !fold;
      if (fold) {
        const done = answered(v);
        const r = recs(q);
        folded.replaceChildren(h("span", { class: `tick ${!done ? "open" : v.decide === "later" ? "later" : v.decide === "agent" ? "agent" : ""}` }, !done ? "" : v.decide === "later" ? "…" : v.decide === "agent" ? "↪" : "✓"),
          h("span", { class: "a" }, done ? summary(q, v) : r.length ? `Open · recommended: ${r.map((id) => optLabel(q, id)).join(", ")}` : "Open"), h("kbd", { class: "hint" }, "↵"));
      }
      if (selBox) selBox.checked = selected.has(q.id);
    };
    return sec;
  }

  function summary(q, v) {
    if (!answered(v)) return "Open";
    if (v.decide === "agent") return "You decide";
    if (v.decide === "later") return "Later";
    if (v.order) return v.order.map((id) => optLabel(q, id)).join(" → ");
    if (v.choice != null) {
      const picks = Array.isArray(v.choice) ? v.choice : [v.choice];
      const r = recs(q);
      return picks.map((id) => `${id === "other" ? v.other || "Something else" : optLabel(q, id)}${r.includes(id) ? " · Recommended" : ""}`).join(", ");
    }
    return `“${String(v.text ?? v.other).slice(0, 80)}”`;
  }

  // --- rows (testdata) ------------------------------------------------------
  function tableOf(name, rows) {
    const columns = rows[0].columns.length ? rows[0].columns : ["Row"];
    const opts = rows[0].options;
    const tbody = h("tbody");
    const allBox = h("input", { type: "checkbox", class: "sel", style: { opacity: "1" }, "aria-label": `Select every row of ${name}`, onchange: (e) => rows.forEach((q) => select(q.id, e.target.checked)) });
    for (const q of rows) {
      const ui = { q };
      uis.set(q.id, ui);
      const selBox = h("input", { type: "checkbox", class: "sel", "aria-label": `Select ${q.text}`, onchange: (e) => select(q.id, e.target.checked) });
      ui.selBox = selBox;
      const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": `Verdict on ${q.text}` });
      const btns = opts.map((o, i) => h("button", { type: "button", role: "radio", "aria-checked": "false", "data-id": o.id, title: o.why || "", onclick: () => ui.choose(o.id, true) }, o.kind ? `${GLYPH[o.kind] ?? ""} ` : "", o.label, i < 9 ? h("kbd", { class: "hint", style: { "margin-left": "4px" } }, i + 1) : null));
      seg.append(...btns);
      const note = h("input", { type: "text", placeholder: "Note", "aria-label": `Note on ${q.text}`, oninput: (e) => { snapshot(true); entry(q.id).note = e.target.value; changed(q.id); } });
      const tr = h("tr", { id: `q-${q.id}`, "data-id": q.id, tabindex: "-1" }, h("td", null, selBox), (q.cells.length ? q.cells : [q.text]).map((c) => h("td", null, c)), h("td", { class: "verdict-cell" }, seg), h("td", { class: "note-cell" }, note));
      ui.el = tr;
      ui.choose = (id) => { snapshot(); entry(q.id).choice = id; changed(q.id); };
      ui.pick = (n) => { const b = btns[n - 1]; if (b) ui.choose(b.dataset.id, true); };
      ui.setChoice = (ids) => { entry(q.id).choice = ids[0]; };
      ui.takeRec = () => false;
      ui.focusNote = () => note.focus();
      ui.sync = () => {
        const v = A[q.id];
        btns.forEach((b) => { const on = v?.choice === b.dataset.id; b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-checked", String(on)); });
        if (note.value !== (v?.note ?? "")) note.value = v?.note ?? "";
        const kind = opts.find((o) => o.id === v?.choice)?.kind;
        tr.classList.toggle("ok-row", kind === "ok");
        selBox.checked = selected.has(q.id);
      };
      tbody.append(tr);
    }
    return [h("div", { class: "group-label" }, name), h("div", { class: "table-wrap" }, h("table", { class: "rows" }, h("thead", null, h("tr", null, h("th", null, allBox), columns.map((c) => h("th", { scope: "col" }, c)), h("th", { scope: "col" }, "Verdict"), h("th", { scope: "col" }, "Note"))), tbody))];
  }

  // --- folding every question, and selecting every one -----------------------
  let foldMode = session.get(`wf-ask:fold:${key}:${spec.id}`) ?? "auto";
  function setFold(mode) {
    foldMode = mode;
    session.set(`wf-ask:fold:${key}:${spec.id}`, mode);
    for (const q of qs) { const u = uis.get(q.id); if (u) { u.unfold = false; u.sync(); } }
    toolbarRefresh();
    toast(mode === "all" ? "Every question folded. Enter or a click opens one." : mode === "none" ? "Every question open." : "Answered questions fold.");
  }
  const selectable = () => qs.filter((q) => uis.get(q.id)?.selBox);
  function selectAll() {
    const all = selectable();
    const on = !all.every((q) => selected.has(q.id));
    all.forEach((q) => select(q.id, on));
  }
  const allBtn = h("button", { class: "ghost", type: "button", role: "checkbox", "aria-checked": "false", onclick: () => selectAll() }, h("span", { class: "check-box", "aria-hidden": "true" }), "Select all", h("kbd", { class: "hint" }, "⇧X"));
  const foldBtns = h("span", { class: "seg", role: "group", "aria-label": "Fold questions" },
    ...[["none", "Expand all"], ["auto", "Fold answered"], ["all", "Collapse all"]].map(([m, label]) => h("button", { type: "button", "data-fold": m, onclick: () => setFold(m) }, label)));
  const toolbar = h("div", { class: "toolbar" }, allBtn, h("span", { class: "grow" }), pages || table ? null : foldBtns);
  function toolbarRefresh() {
    const all = selectable();
    const n = all.filter((q) => selected.has(q.id)).length;
    allBtn.setAttribute("aria-checked", n === 0 ? "false" : n === all.length ? "true" : "mixed");
    allBtn.childNodes[1].textContent = n && n === all.length ? "Select none" : "Select all";
    foldBtns.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fold === foldMode)));
  }

  // --- selection and bulk answers --------------------------------------------
  const selected = new Set();
  function select(id, on) {
    on ? selected.add(id) : selected.delete(id);
    uis.get(id)?.sync();
    document.body.classList.toggle("selecting", selected.size > 0);
    toolbarRefresh();
    if (!selected.size) document.querySelectorAll("thead .sel").forEach((box) => { box.checked = false; });
    footerRefresh();
  }
  const shared = (() => {
    const sets = new Map();
    for (const q of qs.filter((x) => x.type === "one")) {
      const k = q.options.map((o) => o.id).join("\u0000");
      sets.set(k, [...(sets.get(k) ?? []), q]);
    }
    const best = [...sets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    return best.length >= 2 ? { ids: new Set(best.map((q) => q.id)), options: best[0].options } : null;
  })();
  function bulk(targets, act, what) {
    if (!targets.length) return toast(`Nothing to ${what}.`);
    snapshot();
    let done = 0;
    for (const q of targets) if (act(q) !== false) { done++; uis.get(q.id)?.sync(); }
    persist();
    refresh();
    const skipped = targets.length - done;
    toast(`${what[0].toUpperCase()}${what.slice(1)}: ${done}${skipped ? `; ${skipped} had none` : ""}.`, "Undo", undo);
    [...selected].forEach((id) => select(id, false));
  }
  const pool = () => (selected.size ? qs.filter((q) => selected.has(q.id)) : qs.filter(isOpen));
  function takeAll() { bulk(pool().filter((q) => q.type !== "text"), (q) => (recs(q).length || q.type === "rank" ? (q.type === "rank" ? (entry(q.id).order = q.options.map((o) => o.id)) : uis.get(q.id).setChoice(recs(q))) : false), "took the recommendation"); }
  function markAs(opt) { bulk(pool().filter((q) => shared?.ids.has(q.id)), (q) => uis.get(q.id).setChoice([opt.id]), `marked “${opt.label}”`); }
  function decideAll(id) { bulk(pool().filter((q) => q.defer), (q) => { const v = entry(q.id); v.decide = id; delete v.choice; delete v.order; delete v.text; }, id === "agent" ? "left it to the agent" : "kept it for later"); }
  function markPop(anchor) {
    popAt(anchor, h("div", { class: "h" }, selected.size ? `The ${selected.size} selected` : "Every open question"),
      shared.options.map((o) => h("button", { class: "item", type: "button", onclick: () => { closePop(); markAs(o); } }, o.kind ? h("span", { class: "swatch", style: { background: colour(o.kind) } }) : null, h("span", { class: "t" }, o.label))));
  }
  function footerRefresh() {
    const open = qs.filter(isOpen).length;
    const later = qs.filter((q) => A[q.id]?.decide === "later").length;
    const pins = qs.reduce((n, q) => n + (A[q.id]?.pins?.length ?? 0), 0);
    if (selected.size) {
      statusEl.hidden = true;
      selbar.hidden = false;
      selbar.replaceChildren(...[h("b", null, `${selected.size} selected`),
        h("button", { class: "btn", type: "button", onclick: () => takeAll() }, "Recommendations"),
        shared ? h("button", { class: "btn", type: "button", onclick: (e) => markPop(e.currentTarget) }, "Mark as…") : null,
        h("button", { class: "btn", type: "button", onclick: () => decideAll("agent") }, "You decide"),
        h("button", { class: "btn", type: "button", onclick: () => decideAll("later") }, "Later"),
        h("button", { class: "ghost", type: "button", onclick: () => [...selected].forEach((id) => select(id, false)) }, "Clear")].filter(Boolean));
      takeAllBtn.hidden = true;
      markOpenBtn.hidden = true;
    } else {
      statusEl.hidden = false;
      selbar.hidden = true;
      statusEl.replaceChildren(open ? h("b", null, `${open} open`) : h("b", null, "All answered"), later ? ` · ${later} later` : "", pins ? ` · ${pins} ${pins === 1 ? "comment" : "comments"}` : "");
      takeAllBtn.hidden = !qs.some((q) => isOpen(q) && (recs(q).length || q.type === "rank"));
      markOpenBtn.hidden = !(shared && qs.some((q) => isOpen(q) && shared.ids.has(q.id)));
    }
    sendBtn.firstChild.textContent = sent ? "Send again" : open ? "Send" : `Send ${qs.length} ${qs.length === 1 ? "answer" : "answers"}`;
  }
  function refresh() {
    const open = qs.filter(isOpen).length;
    progressPill.textContent = `${qs.length - open} of ${qs.length}`;
    progressBar.style.width = `${((qs.length - open) / qs.length) * 100}%`;
    railRefresh();
    footerRefresh();
    if (pages) stripRefresh();
  }

  // --- moving between questions ----------------------------------------------
  function go(id, scroll) {
    const prev = current;
    current = id;
    if (prev && prev !== id) { const p = uis.get(prev); if (p) { p.unfold = false; p.el.classList.remove("cur"); p.sync(); } }
    const ui = uis.get(id);
    if (!ui) return;
    ui.el.classList.add("cur");
    ui.sync();
    if (pages) showPage(qs.findIndex((q) => q.id === id));
    else if (scroll) {
      ui.el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      ui.el.focus({ preventScroll: true });
    }
    railRefresh();
    session.set(`wf-ask:pos:${key}:${spec.id}`, { id, y: scrollY });
  }
  const step = (d) => { const i = qs.findIndex((q) => q.id === current); const q = qs[Math.max(0, Math.min(qs.length - 1, (i < 0 ? 0 : i) + d))]; go(q.id, true); };
  const nextOpen = () => {
    const i = qs.findIndex((q) => q.id === current);
    const q = [...qs.slice(i + 1), ...qs.slice(0, i + 1)].find(isOpen);
    if (q) go(q.id, true); else { toast("Every question is answered. Ctrl+Enter sends."); sendBtn.focus(); }
  };
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-id]");
    if (el?.closest(".q, tr") && el.closest(".q, tr").dataset.id !== current) {
      const id = el.closest(".q, tr").dataset.id;
      if (uis.has(id) && !pages) { const prev = current; current = id; if (prev) { const p = uis.get(prev); p.unfold = false; p.el.classList.remove("cur"); p.sync(); } uis.get(id).el.classList.add("cur"); railRefresh(); }
    }
  });

  // --- pages (one frame at a time) --------------------------------------------
  let pageIndex = 0;
  const strip = h("div", { class: "strip", role: "list", "aria-label": "Every frame" });
  const grid = h("div", { class: "grid", hidden: true });
  const pagerText = h("span", { class: "num muted" });
  const prevBtn = h("button", { class: "btn", type: "button", onclick: () => showPage(pageIndex - 1) }, "←");
  const nextBtn = h("button", { class: "btn", type: "button", onclick: () => showPage(pageIndex + 1) }, "→");
  const gridBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => toggleGrid() }, "All at once", h("kbd", { class: "hint" }, "G"));
  function toggleGrid(force) {
    const on = force ?? grid.hidden;
    grid.hidden = !on;
    gridBtn.setAttribute("aria-pressed", String(on));
    qs.forEach((q, i) => { uis.get(q.id).el.hidden = on || i !== pageIndex; });
  }
  function thumbOf(q, i, big) {
    const pic = q.compare?.[1] ?? q.pictures[0];
    const b = h("button", { class: "thumb", type: "button", "data-thumb": q.id, "aria-label": `${i + 1}. ${q.text}`, onclick: () => { toggleGrid(false); showPage(i); } },
      pic ? h("img", { src: pic.src, alt: "", loading: "lazy", decoding: "async" }) : null, h("span", { class: "no num" }, i + 1), h("span", { class: "pc", hidden: true }));
    return big ? h("div", null, b, h("div", { class: "cap" }, `${i + 1}. ${q.text}`)) : b;
  }
  function stripRefresh() {
    document.querySelectorAll("[data-thumb]").forEach((b) => {
      const q = qs.find((x) => x.id === b.dataset.thumb);
      const v = A[q.id];
      const kind = q.options.find((o) => o.id === v?.choice)?.kind;
      b.style.setProperty("--vb", kind ? colour(kind) : v?.decide ? "var(--line-3)" : "transparent");
      const n = v?.pins?.length ?? 0;
      const pc = b.querySelector(".pc");
      pc.hidden = !n;
      pc.textContent = n;
      b.classList.toggle("cur", q.id === qs[pageIndex]?.id);
    });
  }
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let built = false;
  // Moving to another frame cross-fades, where the browser can.
  function showPage(i) {
    const to = Math.max(0, Math.min(qs.length - 1, i));
    if (built && to !== pageIndex && document.startViewTransition && !calm.matches) {
      document.documentElement.dataset.dir = to > pageIndex ? "next" : "prev";
      document.startViewTransition(() => drawPage(to));
    } else drawPage(to);
  }
  function drawPage(i) {
    pageIndex = i;
    const q = qs[pageIndex];
    qs.forEach((x, n) => { const el = uis.get(x.id).el; el.hidden = !grid.hidden || n !== pageIndex; el.classList.toggle("cur", n === pageIndex); });
    if (current !== q.id) { current = q.id; railRefresh(); }
    uis.get(q.id).el.classList.add("cur");
    pagerText.textContent = `${pageIndex + 1} of ${qs.length}`;
    prevBtn.disabled = pageIndex === 0;
    nextBtn.disabled = pageIndex === qs.length - 1;
    stripRefresh();
    strip.querySelector(".thumb.cur")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // The next frames load ahead, so moving on never waits.
    for (const n of [pageIndex + 1, pageIndex + 2]) for (const pic of [...(qs[n]?.pictures ?? []), ...(qs[n]?.compare ?? [])]) { const img = new Image(); img.decoding = "async"; img.src = pic.src; }
    try { history.replaceState(null, "", `#${encodeURIComponent(q.id)}`); } catch { /* a file page */ }
  }
  function goNextPage() {
    const after = qs.slice(pageIndex + 1).findIndex(isOpen);
    if (after >= 0) showPage(pageIndex + 1 + after);
    else if (pageIndex < qs.length - 1) showPage(pageIndex + 1);
    else if (!qs.some(isOpen)) { toast("Every frame has a verdict. Ctrl+Enter sends."); sendBtn.focus(); }
  }

  // --- sending, and the receipt ------------------------------------------------
  const payload = () => ({ id: spec.id, hash: spec.hash, submitted: new Date().toISOString(), answers: A });
  let panel = null;
  function trySend() {
    if (sent && receiptShown) return;
    const open = qs.filter(isOpen);
    if (!open.length) return send();
    panel?.remove();
    let choice = "agent";
    const radio = (v, label) => h("label", null, h("input", { type: "radio", name: "rest", value: v, checked: v === choice, onchange: () => { choice = v; } }), label);
    panel = h("div", { class: "sendpanel", role: "dialog", "aria-label": "Unanswered questions" },
      h("h3", null, `${open.length} ${open.length === 1 ? "question is" : "questions are"} still open`),
      h("div", { class: "muted", style: { "font-size": "13px" } }, "Send them as:"),
      h("div", { class: "choices" }, radio("agent", "You decide"), radio("later", "Later"), radio("open", "Leave them open")),
      h("div", { class: "acts" },
        h("button", { class: "btn", type: "button", onclick: () => { panel.remove(); panel = null; go(open[0].id, true); } }, "Go back"),
        h("button", { class: "btn primary", type: "button", onclick: () => {
          panel.remove(); panel = null;
          if (choice !== "open") { snapshot(); for (const q of open) if (q.defer) { const v = entry(q.id); v.decide = choice; } persist(); qs.forEach((q) => uis.get(q.id)?.sync()); refresh(); }
          send();
        } }, "Send", h("kbd", null, "↵"))));
    document.body.append(panel);
    panel.querySelector(".btn.primary").focus();
  }
  let retry = 0;
  let retryTimer = null;
  function sendState(s, text) {
    if (s === "changed") { sendBtn.firstChild.textContent = "Send again"; return; }
    savedEl.className = `saved ${s === "error" ? "err" : "on"}`;
    savedEl.textContent = text;
  }
  async function send() {
    if (!served) { copyAnswers(); return; }
    sendBtn.disabled = true;
    sendState("sending", "Sending…");
    try {
      const res = await fetch(`/__ask/${encodeURIComponent(key)}/answers/${encodeURIComponent(spec.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify(payload()) });
      const body = await res.json().catch(() => ({}));
      sendBtn.disabled = false;
      if (!res.ok) { sendState("error", `Not sent: ${body.error ?? res.status}`); toast(`Not sent: ${body.error ?? res.status}`); return; }
      retry = 0;
      sent = true;
      sendState("sent", `Sent · ${clock()}`);
      showReceipt(body);
    } catch {
      sendBtn.disabled = false;
      retry++;
      const wait = Math.min(30, 2 ** retry);
      sendState("error", `Can't reach the server; your answers are kept here. Trying again in ${wait} s.`);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(send, wait * 1000);
    }
  }
  let receiptShown = false;
  const questionsView = h("div");
  const receiptView = h("div", { class: "receipt", hidden: true, tabindex: "-1" });
  function showReceipt(result) {
    receiptShown = true;
    const open = result?.open ?? qs.filter(isOpen).map((q) => q.id);
    const next = nextAsk();
    receiptView.replaceChildren(
      h("h2", null, open.length ? "Sent, with some left open" : "Sent to the agent"),
      h("p", { class: "sub" }, `${clock()} · ${qs.length - open.length} of ${qs.length} answered. This is exactly what the agent received.`),
      h("div", { class: "acts" },
        next ? h("button", { class: "btn primary", type: "button", onclick: () => location.assign(next.href) }, `Next waiting ask: ${next.title}`, h("kbd", null, "↵")) : null,
        h("button", { class: "btn", type: "button", onclick: () => hideReceipt() }, "Change answers"),
        h("button", { class: "btn", type: "button", onclick: () => copyAnswers(true) }, "Copy as Markdown"),
        served ? h("a", { class: "btn", href: "/" }, "All asks") : null),
      h("ol", null, qs.map((q, i) => h("li", null, h("div", { class: "q-t" }, `${i + 1}. ${q.text}`), h("div", { class: `a-t ${isOpen(q) ? "open" : ""}` }, summary(q, A[q.id]), A[q.id]?.note ? ` — Note: ${A[q.id].note}` : "", A[q.id]?.pins?.length ? ` — ${A[q.id].pins.length} comments` : "")))));
    questionsView.hidden = true;
    receiptView.hidden = false;
    footer.hidden = true;
    scrollTo({ top: 0 });
    receiptView.focus();
    local.drop(draftKey);
  }
  function hideReceipt() {
    receiptShown = false;
    receiptView.hidden = true;
    questionsView.hidden = false;
    footer.hidden = false;
    footerRefresh();
  }
  function markdown() {
    return [`# ${spec.title} (${spec.id})`, "", ...qs.map((q, i) => `- **${i + 1}. ${q.text}** ${summary(q, A[q.id])}${A[q.id]?.note ? ` — Note: ${A[q.id].note}` : ""}`)].join("\n");
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const area = h("textarea", { class: "sr" }, text);
      document.body.append(area); area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }
  async function copyAnswers(md = false) {
    const text = md ? markdown() : `Answers to the ask page ${spec.id} (${spec.hash}). Paste this into the chat, or save it and run npx wf ask import <file>.\n\n\`\`\`json\n${JSON.stringify(payload(), null, 2)}\n\`\`\`\n`;
    toast((await copyText(text)) ? (md ? "Copied as Markdown." : "Copied. Paste it into the chat.") : "Could not copy; use Save answers file.");
  }
  function downloadAnswers() {
    const a = h("a", { href: URL.createObjectURL(new Blob([`${JSON.stringify(payload(), null, 2)}\n`], { type: "application/json" })), download: `${spec.id}.answers.json` });
    document.body.append(a); a.click(); a.remove();
    toast(`Saved ${spec.id}.answers.json. Send it back, or run npx wf ask import on it.`);
  }

  // --- other asks: the switcher in the header --------------------------------------
  let inbox = [];
  const here = `/${key}/ask/${spec.id}/`;
  function waitingQueue() { return inbox.filter((i) => i.state !== "answered").sort((a, b) => a.asked.localeCompare(b.asked)); }
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
      items.map((i) => h("a", { class: `item ${i.href === here ? "on" : ""}`, href: i.href }, h("span", { class: `state ${i.state}` }, i.state === "waiting" ? "Waiting" : i.state === "partial" ? "Partly" : "Answered"), h("span", { class: "t" }, i.title), h("span", { class: "s" }, `${i.asker?.project || i.project} · ${ago(i.asked)}`))),
      h("a", { class: "item", href: "/" }, h("span", { class: "t" }, "Open the inbox"), h("kbd", null, "I")));
  }
  async function pollInbox() {
    try { inbox = (await (await fetch("/__hub/inbox", { cache: "no-store" })).json()).items ?? []; asksRefresh(); } catch { /* the server is away; the page keeps working */ }
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
    qs.forEach((q, i) => out.push({ t: `${i + 1}. ${q.text}`, s: stateOf(q) || "open", run: () => go(q.id, true) }));
    if (qs.some((q) => recs(q).length)) out.push({ t: "Take all recommendations", k: "⇧R", run: takeAll });
    if (shared) for (const o of shared.options) out.push({ t: `Mark every open as ${o.label}`, run: () => markAs(o) });
    out.push({ t: "Select all, or none", k: "⇧X", run: selectAll });
    if (!pages && !table) out.push({ t: "Expand all", k: "E", run: () => setFold("none") }, { t: "Collapse all", k: "⇧E", run: () => setFold("all") }, { t: "Fold answered questions", run: () => setFold("auto") });
    out.push({ t: "Send", k: "Ctrl ↵", run: trySend }, { t: "Next open question", k: "↵", run: nextOpen }, { t: "Undo", k: "Ctrl Z", run: undo }, { t: "Copy answers", run: () => copyAnswers() }, { t: "Keyboard shortcuts", k: "?", run: () => keysDialog.showModal() });
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
  const keysDialog = h("dialog", { class: "keys", "aria-label": "Keyboard shortcuts" }, h("h2", null, "Keyboard"), h("table", null, h("tbody", null, KEYS.map(([k, t]) => h("tr", null, h("td", null, h("kbd", null, k)), h("td", null, t))))), h("p", { class: "muted", style: { "font-size": "12px", margin: "10px 0 0" } }, "Keys work when no text field has focus; Esc leaves one."));
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); if (panel) panel.querySelector(".btn.primary").click(); else trySend(); return; }
    if (mod && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !["checkbox", "radio", "range"].includes(e.target.type);
    if (e.key === "Escape") { if (openPop) { closePop(); return; } if (panel) { panel.remove(); panel = null; return; } if (typing) { e.target.blur(); uis.get(current)?.el.focus({ preventScroll: true }); } return; }
    if (mod && (e.key === "z" || e.key === "Z") && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (typing || mod || e.altKey || document.querySelector("dialog[open]")) return;
    document.body.classList.add("keys");
    if (receiptShown) { if (e.key === "Enter") { const n = nextAsk(); if (n) location.assign(n.href); } return; }
    if (panel && e.key === "Enter") { e.preventDefault(); panel.querySelector(".btn.primary").click(); return; }
    const ui = uis.get(current) ?? uis.get(qs[0].id);
    const k = e.key;
    const keyMap = {
      j: () => step(1), k: () => step(-1), J: () => step(1), K: () => step(-1),
      r: () => { if (ui.takeRec && !ui.takeRec()) toast("This question has no recommendation."); }, R: () => takeAll(),
      d: () => ui.decide?.("agent"), l: () => ui.decide?.("later"), n: () => ui.focusNote?.(),
      x: () => { if (ui.selBox) select(ui.q.id, !selected.has(ui.q.id)); }, X: () => selectAll(),
      e: () => !pages && !table && setFold(foldMode === "none" ? "auto" : "none"), E: () => !pages && !table && setFold("all"),
      c: () => ui.toggleComment?.(), m: () => ui.cycleCompare?.(), g: () => pages && toggleGrid(),
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

  // --- build ---------------------------------------------------------------------
  function build() {
    content.append(newer, questionsView, receiptView);
    if (spec.intro) {
      const intro = h("p", { class: "context" }, spec.intro);
      questionsView.append(intro);
      if (spec.intro.length > 320) {
        intro.classList.add("clamp");
        questionsView.append(h("button", { class: "ghost more", type: "button", onclick: (e) => { intro.classList.toggle("clamp"); e.currentTarget.textContent = intro.classList.contains("clamp") ? "More" : "Less"; } }, "More"));
      }
    }
    if (!served) questionsView.append(h("div", { class: "notice" }, data.offline ? "Answer here, then use Copy answers or Save answers file in the ⋯ menu, and send them back." : "This page is open without its server, so Send copies the answers for the chat."));
    if (draft?.at && !data.previous) {
      const n = h("div", { class: "notice", role: "status" }, h("span", { class: "grow" }, `Restored your draft from ${clock(new Date(draft.at))}.`), h("button", { class: "btn", type: "button", onclick: () => { snapshot(); for (const k of Object.keys(A)) delete A[k]; persist(); qs.forEach((q) => uis.get(q.id)?.sync()); refresh(); n.remove(); toast("Draft discarded.", "Undo", undo); } }, "Discard"));
      questionsView.append(n);
    } else if (data.previous) {
      questionsView.append(h("div", { class: "notice", role: "status" }, `Answered before, ${String(data.previous.submitted ?? "").replace("T", " ").slice(0, 16)}. Change anything and send again.`));
    }
    questionsView.append(toolbar);
    if (table) {
      const groups = new Map();
      for (const q of qs) groups.set(q.table, [...(groups.get(q.table) ?? []), q]);
      for (const [name, rows] of groups) questionsView.append(...tableOf(name, rows));
    } else {
      // Each run of questions under one group is a section of its own, so it can be set apart.
      let group;
      let section = null;
      const list = h("div", { class: "sections" });
      qs.forEach((q, i) => {
        if (!section || (!pages && (q.group || "") !== group)) {
          group = q.group || "";
          section = h("section", { class: "section", "aria-label": group || null }, !pages && group ? h("div", { class: "group-label" }, group) : null);
          list.append(section);
        }
        section.append(question(q, i + 1));
      });
      if (pages) {
        questionsView.append(h("div", { class: "pager" }, prevBtn, pagerText, nextBtn, h("span", { class: "grow" }), gridBtn),
          h("div", { class: "pages-strip" }, strip), grid);
        qs.forEach((q, i) => { strip.append(thumbOf(q, i, false)); grid.append(thumbOf(q, i, true)); });
      }
      questionsView.append(list);
    }
    app.append(full, keysDialog, palette);
    qs.forEach((q) => uis.get(q.id)?.sync());
    refresh();
    toolbarRefresh();
    const pos = session.get(`wf-ask:pos:${key}:${spec.id}`);
    const fromHash = qs.find((q) => `#${encodeURIComponent(q.id)}` === location.hash)?.id;
    const start = fromHash ?? pos?.id ?? (qs.find(isOpen) ?? qs[0]).id;
    if (pages) { showPage(qs.findIndex((q) => q.id === start)); }
    else {
      go(start, false);
      if (pos?.y && !fromHash) requestAnimationFrame(() => scrollTo({ top: pos.y, behavior: "auto" }));
      else if (fromHash) uis.get(fromHash).el.scrollIntoView({ block: "start" });
    }
    built = true;
    addEventListener("pagehide", () => session.set(`wf-ask:pos:${key}:${spec.id}`, { id: current, y: scrollY }));
    if (served) {
      pollInbox();
      pollVersion();
      setInterval(pollInbox, 5000);
      setInterval(pollVersion, 5000);
    }
  }
  build();
})();
