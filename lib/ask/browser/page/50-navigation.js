// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- moving between questions ----------------------------------------------
  function go(id, scroll) {
    const prev = current;
    current = id;
    if (prev && prev !== id) { const p = uis.get(prev); if (p) { p.unfold = false; p.el.classList.remove("cur"); p.sync(); } }
    const ui = uis.get(id);
    if (!ui) return;
    stepTo?.(id);
    ui.el.classList.add("cur");
    ui.sync();
    if (pages) showPage(qs.findIndex((q) => q.id === id));
    else if (scroll) {
      ui.el.scrollIntoView({ block: "start", behavior: M.level() === 2 ? "smooth" : "auto" });
      ui.el.focus({ preventScroll: true });
    }
    railRefresh();
    session.set(`wf-ask:pos:${key}:${spec.id}`, { id, y: scrollY });
  }
  const step = (d) => { const list = live(); const i = list.findIndex((q) => q.id === current); const q = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + d))]; if (q) go(q.id, true); };
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
  let built = false;
  // Moving to another frame cross-fades, where the browser can.
  function showPage(i) {
    const to = Math.max(0, Math.min(qs.length - 1, i));
    if (built && to !== pageIndex && document.startViewTransition && M.level()) {
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

