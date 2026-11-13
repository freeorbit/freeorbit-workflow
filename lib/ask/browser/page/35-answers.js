// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own.
  // --- richer answers: a scale, a grid, a sort, edits, a form, an owner --------
  // Each sets ui.drawRich, which syncQuestion calls to draw it from the answers,
  // and ui.takeRec where the question recommends something.

  const recBadge = () => h("span", { class: "badge" }, "Recommended");
  const recWhy = (q, what) => {
    if (q.noPick) return h("p", { class: "why" }, h("b", null, "No recommendation: "), q.noPick);
    return q.why && q.recommended != null ? h("p", { class: "why" }, h("b", null, `Why ${what}: `), q.why) : null;
  };
  const take = (q) => () => { snapshot(); const ok = S.takeRecommendation(q, entry(q.id)); changed(q.id); return ok; };

  /** A scale: stars to click, a slider, or a number to type; keys 1 to 9 set stars. */
  function scaleAnswer(q, ui, body) {
    const sc = q.scale;
    const set = (n) => { snapshot(); S.clearAnswer(entry(q.id)); delete entry(q.id).decide; if (n != null) entry(q.id).number = n; changed(q.id); };
    const shown = (n) => `${n}${sc.unit ? ` ${sc.unit}` : ""}`;
    const ends = sc.low || sc.high ? h("div", { class: "scale-ends muted small" }, h("span", null, sc.low), h("span", null, sc.high)) : null;
    const box = h("div", { class: `scale scale-${sc.style}` });
    if (sc.style === "stars") {
      const values = [];
      for (let n = sc.min; n <= sc.max; n += sc.step) values.push(n);
      const stars = values.map((n, i) => h("button", { type: "button", class: "star", role: "radio", "aria-checked": "false", "aria-label": shown(n), title: shown(n), tabindex: "-1", "data-n": n,
        onclick: () => set(A[q.id]?.number === n ? null : n),
        onkeydown: (e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault(); e.stopPropagation();
          const to = values[Math.max(0, Math.min(values.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))];
          set(to);
          stars[values.indexOf(to)].focus();
        } }, h("span", { "aria-hidden": "true" }, "★"), sc.max - sc.min > 4 || sc.min === 0 ? h("span", { class: "star-n num" }, n) : null));
      const said = h("span", { class: "scale-said num" });
      box.append(h("div", { class: "stars", role: "radiogroup", "aria-labelledby": `t-${q.id}` }, stars), said);
      ui.drawRich = () => {
        const v = A[q.id]?.number;
        stars.forEach((s) => {
          const n = Number(s.dataset.n);
          s.classList.toggle("lit", v != null && n <= v);
          s.classList.toggle("rec", q.recommended === n);
          s.setAttribute("aria-checked", String(v === n));
          s.setAttribute("tabindex", (v ?? values[0]) === n ? "0" : "-1");
        });
        said.textContent = v == null ? (q.recommended != null ? `Recommended: ${shown(q.recommended)}` : "Not rated") : `${shown(v)}${q.recommended === v ? " · Recommended" : ""}`;
      };
      ui.pick = (n) => { const to = values[n - 1]; if (to != null) { set(to); stars[n - 1].focus(); } };
    } else {
      const input = sc.style === "slider"
        ? h("input", { type: "range", min: sc.min, max: sc.max, step: sc.step, "aria-labelledby": `t-${q.id}`, oninput: (e) => { snapshot(true); S.clearAnswer(entry(q.id)); delete entry(q.id).decide; entry(q.id).number = Number(e.target.value); changed(q.id); } })
        : h("input", { type: "number", class: "num-input", min: sc.min, max: sc.max, step: sc.step, "aria-labelledby": `t-${q.id}`, placeholder: q.recommended != null ? String(q.recommended) : "",
          oninput: (e) => {
            snapshot(true);
            const n = e.target.value === "" ? null : Number(e.target.value);
            const ok = n != null && Number.isFinite(n) && n >= sc.min && n <= sc.max;
            e.target.setAttribute("aria-invalid", String(n != null && !ok));
            S.clearAnswer(entry(q.id)); delete entry(q.id).decide;
            if (ok) entry(q.id).number = n;
            changed(q.id);
          } });
      const said = h("output", { class: "scale-said num" });
      const clear = h("button", { class: "ghost", type: "button", onclick: () => set(null) }, "Clear");
      box.append(input, said, clear);
      ui.drawRich = () => {
        const v = A[q.id]?.number;
        if (sc.style === "slider") {
          input.value = String(v ?? q.recommended ?? (sc.min + sc.max) / 2);
          input.classList.toggle("unset", v == null);
        } else if (document.activeElement !== input) input.value = v == null ? "" : String(v);
        said.textContent = v == null ? (sc.style === "slider" ? "Not set: move the slider" : `From ${shown(sc.min)} to ${shown(sc.max)}`) : `${shown(v)}${q.recommended === v ? " · Recommended" : ""}`;
        clear.hidden = v == null;
      };
      ui.pick = () => input.focus();
    }
    body.append(box, ends);
    if (q.recommended != null || q.noPick) body.append(recWhy(q, shown(q.recommended)));
    ui.takeRec = q.recommended != null ? take(q) : () => false;
  }

  /** A grid: one choice for each row, as radio buttons in a table. */
  function gridAnswer(q, ui, body) {
    const inputs = new Map();
    const rec = q.recommended ?? {};
    const tbody = h("tbody", null, q.rows.map((r) => h("tr", null,
      h("th", { scope: "row" }, h("span", { class: "row-label" }, r.label), r.why ? h("span", { class: "muted desc-sm" }, r.why) : null),
      q.options.map((o) => {
        const input = h("input", { type: "radio", name: `g-${q.id}-${r.id}`, value: o.id, "aria-label": `${r.label}: ${o.label}`, onchange: () => { snapshot(); delete entry(q.id).decide; (entry(q.id).rows ??= {})[r.id] = o.id; changed(q.id); } });
        inputs.set(`${r.id}\n${o.id}`, input);
        return h("td", { class: `cell ${rec[r.id] === o.id ? "rec" : ""}`, title: rec[r.id] === o.id ? "Recommended" : null }, h("label", null, input));
      }))));
    const head = h("thead", null, h("tr", null, h("th", null, ""), q.options.map((o) => h("th", { scope: "col", title: o.why || null }, o.label))));
    const count = h("span", { class: "muted small num" });
    body.append(h("div", { class: "table-wrap grid-wrap" }, h("table", { class: "grid-q" }, head, tbody)),
      h("div", { class: "table-tools" }, count, Object.keys(rec).length ? h("span", { class: "muted small" }, h("span", { class: "rec-dot", "aria-hidden": "true" }), " marks the recommended choice") : null));
    const why = q.options.filter((o) => o.why);
    if (why.length) body.append(h("dl", { class: "defs" }, why.flatMap((o) => [h("dt", null, o.label), h("dd", null, o.why)])));
    if (Object.keys(rec).length || q.noPick) body.append(recWhy(q, "these"));
    ui.drawRich = () => {
      const rows = A[q.id]?.rows ?? {};
      for (const [k, input] of inputs) { const [r, o] = k.split("\n"); input.checked = rows[r] === o; }
      const n = q.rows.filter((r) => rows[r.id]).length;
      count.textContent = `${n} of ${q.rows.length} rows answered`;
    };
    ui.pick = () => tbody.querySelector("input")?.focus();
    ui.takeRec = Object.keys(rec).length ? take(q) : () => false;
  }

  /** A sort: drag each item into a bucket, or pick its bucket from the list on it. */
  function bucketsAnswer(q, ui, body) {
    const rec = q.recommended ?? {};
    const place = (itemId, bucket) => { snapshot(); delete entry(q.id).decide; const rows = (entry(q.id).rows ??= {}); if (bucket) rows[itemId] = bucket; else delete rows[itemId]; changed(q.id); };
    const cols = [{ id: "", label: "Not sorted", why: "" }, ...q.options];
    const lanes = new Map();
    const board = h("div", { class: "buckets", style: { "--n": cols.length } }, cols.map((c) => {
      const lane = h("div", { class: "lane-cards" });
      lanes.set(c.id, lane);
      return h("div", { class: `lane ${c.id ? "" : "unsorted"}`, "data-bucket": c.id,
        ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add("over"); },
        ondragleave: (e) => e.currentTarget.classList.remove("over"),
        ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (q.rows.some((r) => r.id === id)) place(id, c.id); } },
        h("div", { class: "lane-head" }, h("b", null, c.label), h("span", { class: "lane-n muted small num" })), c.why ? h("div", { class: "muted desc-sm lane-why" }, c.why) : null, lane);
    }));
    const cards = new Map(q.rows.map((r) => {
      const sel = h("select", { class: "pick", "aria-label": `Bucket for ${r.label}`, onchange: (e) => place(r.id, e.target.value) }, cols.map((c) => h("option", { value: c.id }, c.label)));
      const card = h("div", { class: "card", draggable: "true", "data-id": r.id, ondragstart: (e) => { e.dataTransfer.setData("text/plain", r.id); card.classList.add("dragging"); }, ondragend: () => card.classList.remove("dragging") },
        h("div", { class: "card-label" }, r.label, rec[r.id] ? h("span", { class: "muted small" }, ` · suggested: ${optLabel(q, rec[r.id])}`) : null), r.why ? h("div", { class: "muted desc-sm" }, r.why) : null, sel);
      return [r.id, { card, sel }];
    }));
    body.append(board);
    if (Object.keys(rec).length || q.noPick) body.append(recWhy(q, "the suggested sort"));
    ui.drawRich = () => {
      const rows = A[q.id]?.rows ?? {};
      for (const r of q.rows) {
        const { card, sel } = cards.get(r.id);
        const at = rows[r.id] ?? "";
        sel.value = at;
        if (card.parentElement !== lanes.get(at)) lanes.get(at).append(card);
      }
      for (const [id, lane] of lanes) lane.parentElement.querySelector(".lane-n").textContent = String(q.rows.filter((r) => (rows[r.id] ?? "") === id).length);
      lanes.get("").parentElement.hidden = q.rows.every((r) => rows[r.id]);
    };
    ui.pick = () => cards.get(q.rows[0].id)?.sel.focus();
    ui.takeRec = Object.keys(rec).length ? take(q) : () => false;
  }

  /** Suggested edits: each a diff to accept or reject, and all at once. */
  function editsAnswer(q, ui, body) {
    const rec = q.recommended ?? {};
    const set = (id, what) => { snapshot(); delete entry(q.id).decide; const e = (entry(q.id).edits ??= {}); if (e[id] === what) delete e[id]; else e[id] = what; changed(q.id); };
    const all = (what) => { snapshot(); delete entry(q.id).decide; entry(q.id).edits = Object.fromEntries(q.edits.map((e) => [e.id, what])); changed(q.id); };
    const piece = (o) => h(o.op === "del" ? "del" : o.op === "add" ? "ins" : "span", { class: `d-${o.op}` }, o.s);
    const line = (o) => o.s.split("\n").map((s) => h("div", { class: `d-line d-${o.op}` }, h("span", { class: "d-mark", "aria-hidden": "true" }, o.op === "del" ? "−" : o.op === "add" ? "+" : " "), s || " "));
    const rowsEls = q.edits.map((e, i) => {
      const btns = [["accept", "Accept"], ["reject", "Reject"]].map(([id, label]) => h("button", { type: "button", "data-v": id, "aria-pressed": "false", onclick: () => set(e.id, id) }, label, rec[e.id] === id ? h("span", { class: "rec-dot", title: "Recommended", "aria-label": "recommended" }) : null));
      const el = h("div", { class: "edit" },
        h("div", { class: "edit-head" }, h("span", { class: "n num" }, `${i + 1}`), h("b", { class: "grow" }, e.label || `Edit ${i + 1}`), h("div", { class: "seg", role: "group", "aria-label": `Edit ${i + 1}` }, btns)),
        h("div", { class: `diff inline by-${e.by}` }, e.by === "word" ? e.ops.map(piece) : e.ops.flatMap(line)),
        e.why ? h("p", { class: "muted desc-sm" }, e.why) : null);
      return { el, btns, id: e.id };
    });
    const count = h("span", { class: "muted small num grow" });
    body.append(h("div", { class: "table-tools" }, count, h("button", { class: "ghost", type: "button", onclick: () => all("accept") }, "Accept all"), h("button", { class: "ghost", type: "button", onclick: () => all("reject") }, "Reject all")),
      h("div", { class: "edits" }, rowsEls.map((r) => r.el)));
    if (Object.keys(rec).length || q.noPick) body.append(recWhy(q, "these"));
    ui.drawRich = () => {
      const v = A[q.id]?.edits ?? {};
      for (const r of rowsEls) {
        r.btns.forEach((b) => b.setAttribute("aria-pressed", String(v[r.id] === b.dataset.v)));
        r.el.dataset.v = v[r.id] ?? "";
      }
      const n = (what) => Object.values(v).filter((x) => x === what).length;
      count.textContent = `${n("accept")} accepted, ${n("reject")} rejected, ${q.edits.length - n("accept") - n("reject")} to go`;
    };
    ui.pick = () => rowsEls[0]?.btns[0].focus();
    ui.takeRec = Object.keys(rec).length ? take(q) : () => false;
  }

  /** A small form: its fields, each checked as it is filled. */
  function formAnswer(q, ui, body) {
    const touched = new Set();
    const els = q.fields.map((f) => {
      const id = `f-${q.id}-${f.id}`;
      const err = h("span", { class: "field-err", id: `${id}-err`, role: "status" });
      const set = (value) => { snapshot(true); delete entry(q.id).decide; const fields = (entry(q.id).fields ??= {}); if (value == null || value === "" || value === false) delete fields[f.id]; else fields[f.id] = value; changed(q.id); };
      const common = { id, "aria-describedby": `${id}-err`, onblur: () => { touched.add(f.id); ui.drawRich(); } };
      let input;
      if (f.kind === "check") input = h("input", { ...common, type: "checkbox", onchange: (e) => set(e.target.checked) });
      else if (f.kind === "select") input = h("select", { ...common, class: "pick", onchange: (e) => set(e.target.value) }, h("option", { value: "" }, "Choose…"), f.options.map((o) => h("option", { value: o.id }, o.label)));
      else if (f.kind === "long") input = h("textarea", { ...common, rows: "3", placeholder: f.placeholder, maxlength: f.max ?? 2000, oninput: (e) => set(e.target.value) });
      else if (f.kind === "number") input = h("input", { ...common, type: "number", min: f.min, max: f.max, placeholder: f.placeholder, oninput: (e) => set(e.target.value === "" ? null : Number(e.target.value)) });
      else input = h("input", { ...common, type: f.kind === "date" ? "date" : "text", placeholder: f.placeholder, maxlength: f.kind === "text" ? f.max ?? 300 : null, oninput: (e) => set(e.target.value) });
      const label = h("label", { for: id, class: "field-label" }, f.label, f.required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null);
      if (f.required) input.setAttribute("aria-required", "true");
      const row = f.kind === "check"
        ? h("div", { class: "form-row check" }, h("label", { class: "check-label" }, input, f.label, f.required ? h("span", { class: "req", "aria-hidden": "true" }, " *") : null), f.help ? h("span", { class: "muted desc-sm" }, f.help) : null, err)
        : h("div", { class: "form-row" }, label, input, f.help ? h("span", { class: "muted desc-sm" }, f.help) : null, err);
      return { f, input, err, row };
    });
    body.append(h("div", { class: "form" }, els.map((e) => e.row)), q.fields.some((f) => f.required) ? h("p", { class: "muted small" }, "* needed") : null);
    ui.drawRich = () => {
      const fields = A[q.id]?.fields ?? {};
      for (const { f, input, err } of els) {
        const v = fields[f.id];
        if (document.activeElement !== input) {
          if (f.kind === "check") input.checked = v === true;
          else input.value = v == null ? "" : String(v);
        }
        const problem = S.fieldProblem(f, v);
        // Say what is wrong once the field was left, or when it holds something wrong.
        const say = problem && (touched.has(f.id) || (v != null && v !== "" && v !== false)) ? problem : "";
        err.textContent = say;
        input.setAttribute("aria-invalid", String(Boolean(say)));
      }
    };
    ui.pick = () => els[0]?.input.focus();
    ui.takeRec = () => false;
  }

  /** Who a question goes to, from its owners. */
  function ownerRow(q, ui, body) {
    const sel = h("select", { class: "pick owner-pick", "aria-label": `Owner of ${q.text}`, onchange: (e) => { snapshot(); entry(q.id).owner = e.target.value; changed(q.id); } }, h("option", { value: "" }, "No one yet"), q.owners.map((n) => h("option", { value: n }, n)));
    body.append(h("div", { class: "owner-row" }, h("span", { class: "muted small" }, "Owner"), sel));
    ui.drawOwner = () => { sel.value = A[q.id]?.owner ?? ""; };
  }
