// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- one question ----------------------------------------------------------
  // A question is its head, then a body built by the part for its type, the
  // quiet row, and pins; syncQuestion draws it from the answers.
  function question(q, number) {
    const ui = { q, commenting: false, optEls: [], deciders: [] };
    uis.set(q.id, ui);
    const sec = h("section", { class: "q", id: `q-${q.id}`, tabindex: "-1", "aria-labelledby": `t-${q.id}`, "data-id": q.id });
    ui.el = sec;
    ui.selBox = q.type === "rank" || off.has("bulk") ? null : h("input", { type: "checkbox", class: "sel", "aria-label": `Select question ${number} for a bulk answer`, onchange: (e) => select(q.id, e.target.checked) });
    const body = h("div");
    const open = () => { ui.unfold = true; ui.sync(); go(q.id, true); };
    ui.folded = h("div", { class: "folded", tabindex: "0", role: "button", onclick: open, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } });
    // The folded line and the body each sit in a wrapper that animates its height.
    ui.foldLine = h("div", { class: "fold-line" }, h("div", null, ui.folded));
    ui.foldBody = h("div", { class: "fold-body" }, h("div", null, body));
    sec.append(
      h("div", { class: "q-head" }, ui.selBox, h("h2", { id: `t-${q.id}` }, h("span", { class: "n" }, `${number}.`), q.text), q.showIf ? h("span", { class: "chip follow", title: "Shown because of an earlier answer" }, `Follows ${qs.findIndex((x) => x.id === q.showIf.question) + 1}`) : null, changeChip(q), q.role ? h("span", { class: "chip" }, q.role) : null),
      ui.foldLine, ui.foldBody);
    if (q.detail) body.append(h("p", { class: "q-sub" }, q.detail));
    if (q.look) body.append(h("p", { class: "look" }, h("b", null, "Where to look: "), q.look));
    if (q.pictures.length || q.compare) body.append(viewer(q, ui));
    if (q.type === "one" || q.type === "many") optionsAnswer(q, ui, body);
    else if (q.type === "text") textAnswer(q, ui, body);
    else if (q.type === "rank") rankAnswer(q, ui, body);
    else if (q.type === "scale") scaleAnswer(q, ui, body);
    else if (q.type === "grid") gridAnswer(q, ui, body);
    else if (q.type === "buckets") bucketsAnswer(q, ui, body);
    else if (q.type === "edits") editsAnswer(q, ui, body);
    else if (q.type === "form") formAnswer(q, ui, body);
    if (q.owners?.length) ownerRow(q, ui, body);
    metaRow(q, ui, body);
    replyThread(q, ui, body);
    if (q.pins) pinsPanel(q, ui, body);
    ui.sync = () => syncQuestion(ui);
    return sec;
  }

  /** One or many options: verdict buttons under a review's picture, or option cards. */
  function optionsAnswer(q, ui, body) {
    const rec = recs(q);
    const optEls = ui.optEls;
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
      if (q.type === "one") S.setChoice(q, v, v.choice === id && !user ? [] : [id]);
      else {
        const now = new Set(Array.isArray(v.choice) ? v.choice : []);
        now.has(id) ? now.delete(id) : now.add(id);
        S.setChoice(q, v, [...now]);
      }
      changed(q.id);
      if (id === "other" && ui.otherInput) { ui.otherInput.hidden = false; ui.otherInput.focus(); }
      if (user && pages && q.type === "one" && look.advance && optEls[0]?.classList.contains("verdict")) setTimeout(() => goNextPage(), 160);
    };
    ui.pick = (n) => {
      const target = n === 0 ? optEls.find((e) => e.dataset.id === "other") : optEls.filter((e) => e.dataset.id !== "other")[n - 1];
      if (target) { ui.choose(target.dataset.id, true); if (!pages) target.focus(); }
    };
    ui.takeRec = () => { if (!rec.length) return false; snapshot(); S.takeRecommendation(q, entry(q.id)); changed(q.id); return true; };
  }

  function textAnswer(q, ui, body) {
    ui.area = h("textarea", { rows: "3", "aria-labelledby": `t-${q.id}`, placeholder: "Your answer", oninput: (e) => { snapshot(true); entry(q.id).text = e.target.value; delete entry(q.id).decide; changed(q.id); } });
    body.append(h("div", { class: "note" }, ui.area));
    ui.pick = () => ui.area.focus();
  }

  /** A ranking: drag, the arrows, or Alt and the up or down arrow move an item. */
  function rankAnswer(q, ui, body) {
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
    // A moved item glides to its new place.
    ui.drawRank = () => M.glide(() => list.children, () => list.replaceChildren(...order().map((id, i) => {
        const o = q.options.find((x) => x.id === id);
        const li = h("li", { "data-key": id, tabindex: "0", draggable: "true", "aria-label": `${i + 1}. ${o.label}`,
          onkeydown: (e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); move(i, i + (e.key === "ArrowDown" ? 1 : -1)); } },
          ondragstart: () => { dragFrom = i; li.classList.add("dragging"); }, ondragend: () => li.classList.remove("dragging"),
          ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); if (dragFrom != null) move(dragFrom, i); dragFrom = null; } },
          h("span", { class: "handle", "aria-hidden": "true" }, "⋮⋮"), h("span", { class: "n" }, `${i + 1}`),
          h("span", { class: "grow" }, h("b", null, o.label), o.why ? h("div", { class: "muted desc-sm" }, o.why) : null),
          h("button", { class: "ghost", type: "button", "aria-label": `Move ${o.label} up`, onclick: () => move(i, i - 1), disabled: i === 0 }, "↑"),
          h("button", { class: "ghost", type: "button", "aria-label": `Move ${o.label} down`, onclick: () => move(i, i + 1), disabled: i === order().length - 1 }, "↓"));
        return li;
      })), (el) => el.dataset.key);
    ui.drawRank();
    body.append(list);
    if (q.why) body.append(h("p", { class: "why" }, h("b", null, "Suggested order, as listed: "), q.why));
    ui.takeRec = () => { snapshot(); S.takeRecommendation(q, entry(q.id)); changed(q.id); return true; };
    ui.pick = () => list.children[0]?.focus();
  }

  /** The quiet row under the answer: You decide, Later, and + Note. */
  function metaRow(q, ui, body) {
    const meta = h("div", { class: "meta" });
    if (q.defer) for (const [id, label, k] of [["agent", "You decide", "D"], ["later", "Later", "L"]]) {
      const b = h("button", { class: "ghost", type: "button", "aria-pressed": "false", onclick: () => ui.decide(id) }, label, h("kbd", { class: "hint" }, k));
      b.dataset.id = id;
      ui.deciders.push(b);
      meta.append(b);
    }
    if (q.type === "rank") meta.append(h("button", { class: "ghost", type: "button", onclick: () => ui.takeRec() }, "This order is right", h("kbd", { class: "hint" }, "R")));
    if (["scale", "grid", "buckets", "edits"].includes(q.type) && q.recommended != null) meta.append(h("button", { class: "ghost", type: "button", onclick: () => ui.takeRec() }, "Take the recommendation", h("kbd", { class: "hint" }, "R")));
    ui.noteBtn = h("button", { class: "ghost", type: "button", onclick: () => ui.focusNote() }, "+ Note", h("kbd", { class: "hint" }, "N"));
    if (meta.childNodes.length) meta.append(h("span", { class: "sep" }));
    meta.append(ui.noteBtn);
    ui.noteArea = h("textarea", { rows: "2", placeholder: "A note for the agent", "aria-label": `Note on ${q.text}`, oninput: (e) => { snapshot(true); entry(q.id).note = e.target.value; e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`; changed(q.id); } });
    ui.noteBox = h("div", { class: "note", hidden: true }, ui.noteArea);
    body.append(meta, ui.noteBox);
    ui.decide = (id) => { snapshot(); S.toggleDecide(entry(q.id), id); changed(q.id); };
    ui.focusNote = () => { ui.noteBox.hidden = false; ui.noteArea.focus(); };
  }

  /** Comments pinned on the question's pictures, placed in comment mode. */
  function pinsPanel(q, ui, body) {
    const pinList = h("ol", { class: "pins" });
    const kindSel = h("select", { class: "pick", "aria-label": "Kind of comment" }, Object.entries(kinds).map(([id, k]) => h("option", { value: id }, k.word)));
    kindSel.value = "bug" in kinds ? "bug" : Object.keys(kinds)[0];
    const pinText = h("input", { type: "text", placeholder: "What is here?", "aria-label": "Comment" });
    let pending = null;
    const all = [...q.pictures, ...(q.compare ?? [])];
    const form = h("div", { class: "pinform", hidden: true }, kindSel, pinText, h("button", { class: "btn primary", type: "button", onclick: () => add() }, "Add"), h("button", { class: "btn", type: "button", onclick: () => cancel() }, "Cancel"));
    const add = () => { if (!pending) return; snapshot(); const v = entry(q.id); v.pins = [...(v.pins ?? []), { ...pending, kind: kindSel.value, text: pinText.value.trim() }]; pending = null; form.hidden = true; pinText.value = ""; changed(q.id); };
    const cancel = () => { pending = null; form.hidden = true; };
    pinText.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); cancel(); } });
    ui.askPin = (at) => { pending = at; form.hidden = false; pinText.focus(); };
    ui.toggleComment = () => {
      ui.toSide?.();
      ui.commenting = !ui.commenting;
      ui.commentBtn?.setAttribute("aria-pressed", String(ui.commenting));
      ui.el.querySelectorAll(".stage").forEach((s) => s.classList.toggle("commenting", ui.commenting));
      if (ui.commenting) toast(off.has("regions") ? "Comment mode: click the picture where something is wrong. C turns it off." : "Comment mode: click where something is wrong, or drag a box around it. C turns it off.");
    };
    ui.drawPins = () => {
      pinList.replaceChildren(...(A[q.id]?.pins ?? []).map((pin, i) => {
        const pic = all[pin.picture];
        return h("li", { onmouseenter: () => ui.el.querySelectorAll(`[data-pin="${i}"]`).forEach((p) => p.classList.add("hl")), onmouseleave: () => ui.el.querySelectorAll(".pin.hl").forEach((p) => p.classList.remove("hl")) },
          h("span", { class: "swatch", style: { background: colour(pin.kind) } }), " ", `${kinds[pin.kind]?.word ?? pin.kind}${pin.w ? " (a box)" : ""} on ${pic?.label || pic?.name || "the picture"}${pin.box != null ? `, box ${pin.box}` : ""}: ${pin.text || "(no text)"}`,
          h("button", { class: "ghost", type: "button", "aria-label": `Remove comment ${i + 1}`, onclick: () => { snapshot(); A[q.id].pins.splice(i, 1); changed(q.id); } }, "Remove"));
      }));
    };
    (body.querySelector(".viewer") ?? body).append(form, pinList);
  }

  /** Draw a question from its answer: picks, the quiet row, the note, pins, and whether it folds. */
  function syncQuestion(ui) {
    const { q, optEls } = ui;
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
    if (ui.noteArea.value !== (v?.note ?? "")) ui.noteArea.value = v?.note ?? "";
    if (v?.note) ui.noteBox.hidden = false;
    ui.noteBtn.firstChild.textContent = v?.note ? "Note" : "+ Note";
    ui.deciders.forEach((b) => b.setAttribute("aria-pressed", String(v?.decide === b.dataset.id)));
    ui.drawRank?.();
    ui.drawRich?.();
    ui.drawOwner?.();
    ui.drawReplies?.();
    ui.drawPins?.();
    // A follow-up shows only while the earlier answer fits.
    // It opens or closes in place when an answer brings it or takes it away.
    const hide = !shownQ(q);
    ui.el.inert = hide;
    if (ui.hiddenNow !== hide) {
      const first = ui.hiddenNow === undefined;
      ui.hiddenNow = hide;
      const apply = (shown) => ui.el.classList.toggle("is-hidden", !shown);
      if (first || !built) apply(!hide);
      else M.reveal(ui.el, !hide, apply);
    }
    ui.el.querySelectorAll(".stage").forEach((s) => s.place?.());
    // Answered questions fold to one line in a list, until opened.
    // A question the agent replied under stays open until the person replies.
    const replyDue = repliesOn && replies[q.id]?.length && !v?.reply;
    const fold = !pages && !ui.unfold && !replyDue && (foldMode === "all" || (foldMode === "auto" && answered(v, q) && current !== q.id));
    ui.el.classList.toggle("is-folded", fold);
    ui.foldBody.inert = fold;
    ui.foldLine.inert = !fold;
    if (fold) {
      const done = answered(v, q);
      const r = recs(q);
      ui.folded.replaceChildren(h("span", { class: `tick ${!done ? "open" : v.decide === "later" ? "later" : v.decide === "agent" ? "agent" : ""}` }, !done ? "" : v.decide === "later" ? "…" : v.decide === "agent" ? "↪" : "✓"),
        h("span", { class: "a" }, done ? summary(q, v) : r.length ? `Open · recommended: ${r.map((id) => optLabel(q, id)).join(", ")}` : "Open"), h("kbd", { class: "hint" }, "↵"));
    }
    if (ui.selBox) ui.selBox.checked = selected.has(q.id);
  }

  function summary(q, v) {
    if (!answered(v, q)) {
      const p = S.progressOf(q, v);
      return p?.done ? `Open · ${p.done} of ${p.total} done` : v?.fields ? "Open · the form is not finished" : "Open";
    }
    if (v.decide === "agent") return "You decide";
    if (v.decide === "later") return "Later";
    if (v.order) return v.order.map((id) => optLabel(q, id)).join(" → ");
    const owner = v.owner ? ` · ${v.owner}` : "";
    if (v.number != null) return `${v.number}${q.scale?.unit ? ` ${q.scale.unit}` : ""}${q.recommended === v.number ? " · Recommended" : ""}${owner}`;
    if (v.rows && q.type === "buckets") return q.options.map((o) => `${o.label}: ${q.rows.filter((r) => v.rows[r.id] === o.id).length}`).join(", ") + owner;
    if (v.rows) return `${q.rows.length} rows answered${q.rows.every((r) => q.recommended?.[r.id] === v.rows[r.id]) ? " · as recommended" : ""}${owner}`;
    if (v.edits) { const n = Object.values(v.edits).filter((x) => x === "accept").length; return `${n} accepted, ${q.edits.length - n} rejected${owner}`; }
    if (v.fields) return q.fields.filter((f) => v.fields[f.id] != null).map((f) => `${f.label}: ${f.kind === "check" ? "✓" : f.kind === "select" ? f.options.find((o) => o.id === v.fields[f.id])?.label ?? v.fields[f.id] : v.fields[f.id]}`).join(", ").slice(0, 120) + owner;
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
    const allBox = h("input", { type: "checkbox", class: "sel shown", "aria-label": `Select every row of ${name}`, onchange: (e) => rows.forEach((q) => select(q.id, e.target.checked)) });
    for (const q of rows) {
      const ui = { q };
      uis.set(q.id, ui);
      const selBox = h("input", { type: "checkbox", class: "sel", "aria-label": `Select ${q.text}`, onchange: (e) => select(q.id, e.target.checked) });
      ui.selBox = selBox;
      const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": `Verdict on ${q.text}` });
      const btns = opts.map((o, i) => h("button", { type: "button", role: "radio", "aria-checked": "false", "data-id": o.id, title: o.why || "", onclick: () => ui.choose(o.id, true) }, o.kind ? `${GLYPH[o.kind] ?? ""} ` : "", o.label, i < 9 ? h("kbd", { class: "hint" }, i + 1) : null));
      seg.append(...btns);
      const note = h("input", { type: "text", placeholder: "Note", "aria-label": `Note on ${q.text}`, oninput: (e) => { snapshot(true); entry(q.id).note = e.target.value; changed(q.id); } });
      const tr = h("tr", { id: `q-${q.id}`, "data-id": q.id, tabindex: "-1" }, h("td", null, selBox), (q.cells.length ? q.cells : [q.text]).map((c) => h("td", null, c)), h("td", { class: "verdict-cell" }, seg), h("td", { class: "note-cell" }, note));
      ui.el = tr;
      ui.choose = (id) => { snapshot(); S.setChoice(q, entry(q.id), [id]); changed(q.id); };
      ui.pick = (n) => { const b = btns[n - 1]; if (b) ui.choose(b.dataset.id, true); };
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

