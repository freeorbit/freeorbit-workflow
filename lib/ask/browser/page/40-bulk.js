// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, in order: the frame (helpers, the
// look, the answers and undo, header, popovers, outline, settings),
// pictures, a question, bulk answers, moving around, sending, other asks
// with the command palette and keys, and building the page.
  // --- folding every question, and selecting every one -----------------------
  let foldMode = session.get(`wf-ask:fold:${key}:${spec.id}`) ?? "auto";
  function setFold(mode) {
    foldMode = mode;
    session.set(`wf-ask:fold:${key}:${spec.id}`, mode);
    for (const q of qs) { const u = uis.get(q.id); if (u) { u.unfold = false; u.sync(); } }
    toolbarRefresh();
    toast(mode === "all" ? "Every question folded. Enter or a click opens one." : mode === "none" ? "Every question open." : "Answered questions fold.");
  }
  const selectable = () => qs.filter((q) => uis.get(q.id)?.selBox && shownQ(q));
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
  // Bulk answers make the same change each question's own controls make.
  function takeAll() { bulk(pool().filter((q) => q.type !== "text"), (q) => S.takeRecommendation(q, entry(q.id)), "took the recommendation"); }
  function markAs(opt) { bulk(pool().filter((q) => shared?.ids.has(q.id)), (q) => S.setChoice(q, entry(q.id), [opt.id]), `marked “${opt.label}”`); }
  function decideAll(id) { bulk(pool().filter((q) => q.defer), (q) => S.setDecide(entry(q.id), id), id === "agent" ? "left it to the agent" : "kept it for later"); }
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
      takeAllBtn.hidden = off.has("bulk") || !qs.some((q) => isOpen(q) && (recs(q).length || q.type === "rank" || (q.recommended != null && typeof q.recommended !== "string")));
      markOpenBtn.hidden = off.has("bulk") || !(shared && qs.some((q) => isOpen(q) && shared.ids.has(q.id)));
    }
    const n = live().length;
    sendBtn.firstChild.textContent = sent ? "Send again" : open ? "Send" : `Send ${n} ${n === 1 ? "answer" : "answers"}`;
  }
  function refresh() {
    const open = qs.filter(isOpen).length;
    const n = live().length;
    progressPill.textContent = `${n - open} of ${n}`;
    progressBar.style.width = `${((n - open) / n) * 100}%`;
    railRefresh();
    footerRefresh();
    if (pages) stripRefresh();
  }

