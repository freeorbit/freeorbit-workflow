// The ask page in the browser: draws the spec's questions, keeps a draft in
// this browser, and sends the answers to the question-pictures server, or,
// offline, copies them or saves them as a file for `wf ask import`.
(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("ask-data").textContent);
  const { spec, kinds } = data;
  const token = document.querySelector('meta[name="wf-token"]')?.content ?? "";
  const served = !data.offline && /^https?:$/.test(location.protocol) && token && !token.startsWith("__WF_ASK");
  const draftKey = `wf-ask:${spec.id}:${spec.hash}`;
  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem(draftKey) ?? "null"); } catch { return null; }
    },
    set(value) {
      try { localStorage.setItem(draftKey, JSON.stringify(value)); } catch { /* a private window keeps no draft */ }
    },
  };
  const state = store.get() ?? structuredClone(data.previous?.answers ?? {});
  const qs = spec.questions;
  const byId = new Map(qs.map((q) => [q.id, q]));
  const app = document.getElementById("app");

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return node;
  }
  const colour = (kind) => kinds[kind]?.color ?? "#3b82f6";

  // --- answers ---------------------------------------------------------
  const answered = (v) => Boolean(v && (v.choice != null || v.order || v.text || v.decide || v.other));
  const entry = (id) => (state[id] ??= {});
  const sections = new Map();
  function changed(id) {
    const v = state[id];
    if (v) for (const key of Object.keys(v)) if (v[key] == null || v[key] === "" || (Array.isArray(v[key]) && !v[key].length && key !== "pins")) delete v[key];
    if (v && !Object.keys(v).length) delete state[id];
    store.set(state);
    sections.get(id)?.classList.toggle("done", answered(state[id]));
    document.querySelectorAll(`[data-thumb="${CSS.escape(id)}"]`).forEach((b) => b.classList.toggle("done", answered(state[id])));
    progress();
    if (status.dataset.kind === "saved") say("Changed since it was sent; send again to save.", "");
  }
  const openIds = () => qs.filter((q) => !answered(state[q.id])).map((q) => q.id);

  // --- the bar ---------------------------------------------------------
  const status = h("span", { class: "status", role: "status", "aria-live": "polite" });
  const count = h("span", { class: "muted" });
  function say(text, kind) {
    status.textContent = text;
    status.className = `status ${kind ?? ""}`;
    status.dataset.kind = kind ?? "";
  }
  function progress() {
    const open = openIds().length;
    count.textContent = `${qs.length - open} of ${qs.length} answered`;
  }
  const payload = () => ({ id: spec.id, hash: spec.hash, submitted: new Date().toISOString(), answers: state });
  async function send() {
    if (!served) return copy();
    say("Sending…", "");
    try {
      const res = await fetch(`/__ask/answers/${encodeURIComponent(spec.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify(payload()) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return say(`Not saved: ${body.error ?? res.status}`, "error");
      say(body.partial ? `Saved, with ${body.open.length} still open. Answer more and send again any time.` : "Saved. Every question is answered; the agent has them.", "saved");
    } catch {
      say("Not saved: the server is not running. Copy the answers instead.", "error");
    }
  }
  function answersText() {
    return `Answers to the ask page ${spec.id} (${spec.hash}). Paste this into the chat, or save it and run npx wf ask import <file>.\n\n\`\`\`json\n${JSON.stringify(payload(), null, 2)}\n\`\`\`\n`;
  }
  async function copy() {
    const text = answersText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = h("textarea", { class: "sr" }, text);
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    say("Copied. Paste it into the chat.", "saved");
  }
  function download() {
    const blob = new Blob([`${JSON.stringify(payload(), null, 2)}\n`], { type: "application/json" });
    const link = h("a", { href: URL.createObjectURL(blob), download: `${spec.id}.answers.json` });
    document.body.append(link);
    link.click();
    link.remove();
    say(`Saved ${spec.id}.answers.json. Send it back, or run npx wf ask import on it.`, "saved");
  }
  const bar = h(
    "div",
    { class: "bar" },
    h("div", { class: "grow" }, count, " · ", status),
    served ? h("button", { class: "primary", onclick: send, title: "Ctrl+Enter" }, "Send answers") : null,
    h("button", { onclick: copy, class: served ? "" : "primary" }, "Copy answers"),
    h("button", { onclick: download }, "Save answers file"),
    h("button", { onclick: () => print() }, "Print"),
    h("button", { onclick: () => keysDialog.showModal(), "aria-label": "Keyboard shortcuts" }, "?"),
  );

  // --- pictures, boxes, pins ------------------------------------------
  const full = h("dialog", { class: "full", onclick: () => full.close() }, h("img", { alt: "" }));
  function showFull(pic) {
    full.querySelector("img").src = pic.src;
    full.querySelector("img").alt = pic.name || pic.label || "picture";
    full.showModal();
  }
  function stage(q, pic, index, pinnable) {
    const img = h("img", { src: pic.src, alt: pic.name || pic.label || `picture ${index + 1}`, draggable: "false" });
    const node = h("div", { class: `stage${pinnable ? " pinnable" : ""}` }, img);
    const place = () => {
      const w = img.naturalWidth || 1;
      const ht = img.naturalHeight || 1;
      node.dataset.w = w;
      node.querySelectorAll(".box,.pin").forEach((each) => each.remove());
      for (const box of pic.boxes ?? []) {
        const [x, y, bw, bh] = box.rect;
        node.append(h("div", { class: "box", title: box.text || box.kind, style: { left: `${(x / w) * 100}%`, top: `${(y / ht) * 100}%`, width: `${(bw / w) * 100}%`, height: `${(bh / ht) * 100}%`, "--c": colour(box.kind) } }, h("span", null, box.n)));
        node.lastChild.style.setProperty("--c", colour(box.kind));
      }
      (state[q.id]?.pins ?? []).forEach((pin, i) => {
        if (pin.picture !== index) return;
        const dot = h("div", { class: "pin", title: pin.text, style: { left: `${(pin.x / w) * 100}%`, top: `${(pin.y / ht) * 100}%` } }, i + 1);
        dot.style.setProperty("--c", colour(pin.kind));
        node.append(dot);
      });
    };
    img.addEventListener("load", place);
    node.place = place;
    if (pinnable) {
      node.addEventListener("click", (event) => {
        const rect = img.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * img.naturalWidth;
        const y = ((event.clientY - rect.top) / rect.height) * img.naturalHeight;
        const box = (pic.boxes ?? []).find((b) => x >= b.rect[0] && x <= b.rect[0] + b.rect[2] && y >= b.rect[1] && y <= b.rect[1] + b.rect[3]);
        sections.get(q.id)?.askPin({ picture: index, x, y, box: box?.n });
      });
    }
    return node;
  }
  function figure(q, pic, index, pinnable) {
    const st = stage(q, pic, index, pinnable);
    return h(
      "figure",
      { class: "pic" },
      h("figcaption", null, pic.label ? h("span", { class: "label" }, pic.label) : null, h("span", { class: "grow" }, pic.name || ""), h("button", { type: "button", onclick: () => showFull(pic), "aria-label": `Full size: ${pic.name || pic.label || "picture"}` }, "Full size")),
      h("div", { class: "scroll" }, st),
    );
  }

  function compareView(q, offset) {
    const [a, b] = q.compare;
    let mode = "side";
    let zoom = "fit";
    const wrap = h("div", { class: "compare" });
    const body = h("div");
    const slider = h("input", { type: "range", min: "0", max: "100", value: "50", "aria-label": "How much of the first picture shows" });
    const sync = (panes) => {
      let busy = false;
      panes.forEach((pane) => pane.addEventListener("scroll", () => {
        if (busy) return;
        busy = true;
        panes.forEach((other) => { if (other !== pane) { other.scrollTop = pane.scrollTop; other.scrollLeft = pane.scrollLeft; } });
        requestAnimationFrame(() => { busy = false; });
      }));
    };
    const sized = (node) => {
      const img = node.querySelector("img");
      const apply = () => node.style.setProperty("--w", zoom === "fit" ? "100%" : `${img.naturalWidth * Number(zoom)}px`);
      img.complete ? apply() : img.addEventListener("load", apply);
    };
    function draw() {
      body.replaceChildren();
      slider.hidden = mode === "side" || mode === "diff";
      if (mode === "side") {
        const left = figure(q, a, offset, q.pins);
        const right = figure(q, b, offset + 1, q.pins);
        body.append(h("div", { class: "side" }, left, right));
        [left, right].forEach((f) => sized(f.querySelector(".stage")));
        sync([left.querySelector(".scroll"), right.querySelector(".scroll")]);
      } else {
        const base = stage(q, b, offset + 1, false);
        const top = stage(q, a, offset, false);
        top.classList.add("top");
        const over = h("div", { class: `over ${mode}` }, base, top);
        const at = () => { over.style.setProperty("--at", `${slider.value}%`); over.style.setProperty("--op", String(slider.value / 100)); };
        slider.oninput = at;
        at();
        [base, top].forEach(sized);
        body.append(h("p", { class: "muted" }, `${a.label || "First"} over ${b.label || "second"}. ${mode === "diff" ? "What is the same goes dark; what differs lights up." : "Move the slider."} Pins go on the side-by-side view.`), h("div", { class: "scroll" }, over));
      }
    }
    const modes = [["side", "Side by side"], ["swipe", "Swipe"], ["onion", "Onion skin"], ["diff", "Difference"]];
    const buttons = modes.map(([id, label]) => h("button", { type: "button", "aria-pressed": String(id === mode), onclick: () => { mode = id; buttons.forEach((btn, i) => btn.setAttribute("aria-pressed", String(modes[i][0] === mode))); draw(); } }, label));
    const zoomSelect = h("select", { "aria-label": "Zoom", style: { width: "auto" }, onchange: (e) => { zoom = e.target.value; draw(); } }, h("option", { value: "fit" }, "Fit"), h("option", { value: "1" }, "100%"), h("option", { value: "2" }, "200%"));
    wrap.append(h("div", { class: "modes", role: "group", "aria-label": "How to compare" }, buttons, zoomSelect, slider), body);
    draw();
    wrap.redraw = draw;
    return wrap;
  }

  // --- one question -----------------------------------------------------
  function question(q, number) {
    const sec = h("section", { class: "q", id: `q-${q.id}`, tabindex: "-1", "aria-labelledby": `t-${q.id}`, "data-id": q.id });
    sections.set(q.id, sec);
    const v = () => entry(q.id);
    const headerRow = h(
      "header",
      null,
      h("h2", { id: `t-${q.id}` }, `${number}. ${q.text}`),
      q.role ? h("span", { class: "chip" }, q.role) : null,
      h("span", { class: "chip" }, q.id),
    );
    sec.append(headerRow);
    if (q.detail) sec.append(h("p", { class: "detail muted" }, q.detail));
    if (q.look) sec.append(h("p", { class: "look" }, h("strong", null, "Where to look: "), q.look));
    if (q.why && q.recommended != null) sec.append(h("p", { class: "why" }, h("strong", null, "Why the recommendation: "), q.why));
    const redraws = [];
    if (q.pictures.length) {
      const pics = h("div", { class: "pics" }, q.pictures.map((pic, i) => figure(q, pic, i, q.pins)));
      sec.append(pics);
    }
    if (q.compare) {
      const view = compareView(q, q.pictures.length);
      redraws.push(view.redraw);
      sec.append(view);
    }

    // The answer controls.
    const rec = Array.isArray(q.recommended) ? q.recommended : q.recommended != null ? [q.recommended] : [];
    const inputs = [];
    if (q.type === "one" || q.type === "many") {
      const set = h("fieldset", null, h("legend", { class: "sr" }, q.text));
      const kind = q.type === "one" ? "radio" : "checkbox";
      q.options.forEach((opt, i) => {
        const input = h("input", { type: kind, name: `o-${q.id}`, value: opt.id });
        input.addEventListener("change", () => {
          const e = v();
          if (q.type === "one") e.choice = opt.id;
          else e.choice = inputs.filter((x) => x.checked && x.value !== "other").map((x) => x.value).concat(otherBox?.checked ? ["other"] : []);
          delete e.decide;
          deciders.forEach((b) => b.setAttribute("aria-pressed", "false"));
          changed(q.id);
        });
        inputs.push(input);
        set.append(h(
          "label",
          { class: "opt" },
          input,
          h("span", { class: "key", "aria-hidden": "true" }, i < 9 ? i + 1 : ""),
          h(
            "span",
            { class: "body" },
            opt.kind ? h("span", { class: "swatch", style: { background: colour(opt.kind) } }) : null,
            h("strong", null, opt.label),
            rec.includes(opt.id) ? h("span", { class: "rec" }, "Recommended") : null,
            opt.why ? h("div", { class: "why" }, opt.why) : null,
            opt.preview ? h("pre", { class: "preview" }, opt.preview) : null,
          ),
        ));
      });
      var otherBox = null;
      if (q.other) {
        otherBox = h("input", { type: kind, name: `o-${q.id}`, value: "other" });
        const otherText = h("input", { type: "text", placeholder: "Your own words", "aria-label": `Your own answer to ${q.text}`, value: state[q.id]?.other ?? "" });
        otherBox.addEventListener("change", () => { inputs.find((x) => x === otherBox); const e = v(); e.choice = q.type === "one" ? "other" : inputs.filter((x) => x.checked).map((x) => x.value); delete e.decide; changed(q.id); otherText.focus(); });
        otherText.addEventListener("input", () => { const e = v(); e.other = otherText.value; if (otherText.value && !otherBox.checked) { otherBox.checked = true; e.choice = q.type === "one" ? "other" : inputs.filter((x) => x.checked).map((x) => x.value); } changed(q.id); });
        inputs.push(otherBox);
        set.append(h("label", { class: "opt" }, otherBox, h("span", { class: "key", "aria-hidden": "true" }, "0"), h("span", { class: "body" }, h("strong", null, "Something else"))), h("div", { class: "other" }, otherText));
      }
      sec.append(set);
      sec.pick = (n) => {
        const input = n === 0 ? otherBox : inputs.filter((x) => x !== otherBox)[n - 1];
        if (!input) return;
        if (input.type === "checkbox") input.checked = !input.checked;
        else input.checked = true;
        input.dispatchEvent(new Event("change"));
        input.focus();
      };
    } else if (q.type === "text") {
      const area = h("textarea", { rows: "3", "aria-label": q.text, placeholder: "Your answer" }, state[q.id]?.text ?? "");
      area.addEventListener("input", () => { v().text = area.value; delete v().decide; changed(q.id); });
      sec.append(h("div", { class: "note" }, area));
    } else if (q.type === "rank") {
      const listEl = h("ol", { class: "rank", "aria-label": "Order, first at the top" });
      const order = () => state[q.id]?.order ?? q.options.map((o) => o.id);
      const move = (from, to) => {
        const now = [...order()];
        if (to < 0 || to >= now.length) return;
        const [item] = now.splice(from, 1);
        now.splice(to, 0, item);
        v().order = now;
        delete v().decide;
        changed(q.id);
        drawRank(to);
      };
      let dragFrom = null;
      function drawRank(focusAt) {
        listEl.replaceChildren();
        order().forEach((id, i) => {
          const opt = q.options.find((o) => o.id === id);
          const up = h("button", { type: "button", "aria-label": `Move ${opt.label} up`, onclick: () => move(i, i - 1), disabled: i === 0 }, "↑");
          const down = h("button", { type: "button", "aria-label": `Move ${opt.label} down`, onclick: () => move(i, i + 1), disabled: i === order().length - 1 }, "↓");
          const li = h("li", { draggable: "true" }, h("span", { class: "n" }, `${i + 1}.`), h("span", { class: "grow" }, h("strong", null, opt.label), opt.why ? h("div", { class: "why" }, opt.why) : null), up, down);
          li.addEventListener("dragstart", () => { dragFrom = i; li.classList.add("dragging"); });
          li.addEventListener("dragend", () => li.classList.remove("dragging"));
          li.addEventListener("dragover", (e) => e.preventDefault());
          li.addEventListener("drop", (e) => { e.preventDefault(); if (dragFrom != null) move(dragFrom, i); dragFrom = null; });
          listEl.append(li);
          if (focusAt === i) (i > 0 ? up : down).focus();
        });
      }
      drawRank();
      sec.append(listEl, h("div", { class: "extras" }, h("button", { type: "button", onclick: () => { v().order = order(); delete v().decide; changed(q.id); } }, "This order is right")));
    }

    // You decide, later, the note, and pins.
    const deciders = [];
    const extras = h("div", { class: "extras" });
    if (q.defer) {
      for (const [id, label] of [["agent", "You decide"], ["later", "Later"]]) {
        const btn = h("button", { type: "button", "aria-pressed": String(state[q.id]?.decide === id), onclick: () => {
          const e = v();
          e.decide = e.decide === id ? undefined : id;
          if (e.decide) { delete e.choice; delete e.order; delete e.text; inputs.forEach((x) => { x.checked = false; }); }
          deciders.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === e.decide)));
          changed(q.id);
        } }, label);
        btn.dataset.id = id;
        deciders.push(btn);
        extras.append(btn);
      }
    }
    if (q.pins) extras.append(h("span", { class: "muted" }, "Click a picture to pin a comment on it."));
    if (extras.childNodes.length) sec.append(extras);
    const note = h("textarea", { rows: "2", placeholder: "Note (optional)", "aria-label": `Note on ${q.text}` }, state[q.id]?.note ?? "");
    note.addEventListener("input", () => { v().note = note.value; changed(q.id); });
    sec.append(h("div", { class: "note" }, note));

    if (q.pins) {
      const pinList = h("ol", { class: "pins" });
      const form = h("div", { class: "pinform", hidden: true });
      const kindSel = h("select", { "aria-label": "Kind of pin" }, Object.entries(kinds).map(([id, k]) => h("option", { value: id }, k.word)));
      kindSel.value = "bug" in kinds ? "bug" : Object.keys(kinds)[0];
      const pinText = h("input", { type: "text", placeholder: "What is here?", "aria-label": "Pin comment" });
      let pending = null;
      const redrawAll = () => { sec.querySelectorAll(".stage").forEach((s) => s.place?.()); drawPins(); };
      const add = () => {
        if (!pending) return;
        const e = v();
        e.pins = [...(e.pins ?? []), { ...pending, kind: kindSel.value, text: pinText.value }];
        pending = null;
        form.hidden = true;
        pinText.value = "";
        changed(q.id);
        redrawAll();
      };
      pinText.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { pending = null; form.hidden = true; } });
      form.append(kindSel, pinText, h("button", { type: "button", class: "primary", onclick: add }, "Add pin"), h("button", { type: "button", onclick: () => { pending = null; form.hidden = true; } }, "Cancel"));
      const all = [...q.pictures, ...(q.compare ?? [])];
      function drawPins() {
        pinList.replaceChildren();
        (state[q.id]?.pins ?? []).forEach((pin, i) => {
          const pic = all[pin.picture];
          pinList.append(h("li", null, h("span", { class: "swatch", style: { background: colour(pin.kind) } }), `${kinds[pin.kind]?.word ?? pin.kind} on ${pic?.label || pic?.name || "picture"}${pin.box != null ? `, box ${pin.box}` : ""}: ${pin.text || "(no text)"}`, h("button", { type: "button", "aria-label": `Remove pin ${i + 1}`, onclick: () => { v().pins.splice(i, 1); changed(q.id); redrawAll(); } }, "Remove")));
        });
      }
      sec.askPin = (at) => {
        pending = { picture: at.picture, x: Math.round(at.x), y: Math.round(at.y), ...(at.box != null ? { box: at.box } : {}) };
        form.hidden = false;
        pinText.focus();
      };
      drawPins();
      sec.append(form, pinList);
    }

    // Fill in what was answered before.
    const saved = state[q.id];
    if (saved?.choice != null) {
      const picks = Array.isArray(saved.choice) ? saved.choice : [saved.choice];
      inputs.forEach((x) => { x.checked = picks.includes(x.value); });
    }
    sec.classList.toggle("done", answered(saved));
    sec.redraw = () => redraws.forEach((r) => r());
    return sec;
  }

  // --- a table of rows (testdata) ----------------------------------------
  function table(name, rows) {
    const columns = rows[0].columns.length ? rows[0].columns : ["Row"];
    const opts = rows[0].options;
    const body = h("tbody");
    for (const q of rows) {
      const tr = h("tr", { id: `q-${q.id}`, "data-id": q.id, tabindex: "-1" });
      sections.set(q.id, tr);
      const cells = q.cells.length ? q.cells : [q.text];
      cells.forEach((cell) => tr.append(h("td", null, cell)));
      const radios = h("td", { class: "verdict" });
      const inputs = opts.map((opt) => {
        const input = h("input", { type: "radio", name: `o-${q.id}`, value: opt.id, checked: state[q.id]?.choice === opt.id });
        input.addEventListener("change", () => { entry(q.id).choice = opt.id; changed(q.id); });
        radios.append(h("label", null, input, " ", opt.label));
        return input;
      });
      tr.pick = (n) => { const input = inputs[n - 1]; if (input) { input.checked = true; input.dispatchEvent(new Event("change")); input.focus(); } };
      const note = h("input", { type: "text", placeholder: "Note", "aria-label": `Note on ${q.text}`, value: state[q.id]?.note ?? "" });
      note.addEventListener("input", () => { entry(q.id).note = note.value; changed(q.id); });
      tr.append(radios, h("td", null, note));
      tr.classList.toggle("done", answered(state[q.id]));
      body.append(tr);
    }
    return h("div", null, h("h3", { class: "group" }, name), h("div", { class: "wrap" }, h("table", { class: "rows" }, h("thead", null, h("tr", null, columns.map((c) => h("th", { scope: "col" }, c)), h("th", { scope: "col" }, "Verdict"), h("th", { scope: "col" }, "Note"))), body)));
  }

  // --- the page ----------------------------------------------------------
  let current = 0;
  let focused = null;
  const list = h("div", { id: "questions" });
  const pager = h("nav", { class: "pager", "aria-label": "Pages" });
  const strip = h("div", { class: "strip", role: "list" });
  const grid = h("div", { class: "grid", hidden: true });

  function show(i) {
    current = Math.max(0, Math.min(qs.length - 1, i));
    qs.forEach((q, n) => { const s = sections.get(q.id); s.hidden = n !== current; });
    sections.get(qs[current].id).redraw?.();
    pagerText.textContent = `${current + 1} of ${qs.length}`;
    prev.disabled = current === 0;
    next.disabled = current === qs.length - 1;
    document.querySelectorAll("[data-thumb]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.thumb === qs[current].id)));
    strip.querySelector(`[data-thumb="${CSS.escape(qs[current].id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    try { history.replaceState(null, "", `#${encodeURIComponent(qs[current].id)}`); } catch { /* file pages may refuse */ }
  }
  const pagerText = h("span", { "aria-live": "polite" });
  const prev = h("button", { type: "button", onclick: () => show(current - 1), "aria-label": "Previous (left arrow)" }, "← Previous");
  const next = h("button", { type: "button", onclick: () => show(current + 1), "aria-label": "Next (right arrow)" }, "Next →");
  const gridBtn = h("button", { type: "button", "aria-pressed": "false", onclick: () => {
    grid.hidden = !grid.hidden;
    gridBtn.setAttribute("aria-pressed", String(!grid.hidden));
    list.hidden = !grid.hidden;
  } }, "All at once");
  const firstOpen = h("button", { type: "button", onclick: () => { const id = openIds()[0]; if (id) { if (!grid.hidden) gridBtn.click(); show(qs.findIndex((q) => q.id === id)); } } }, "Next open");

  function thumb(q, i, big) {
    const pic = q.pictures[0] ?? q.compare?.[1];
    const btn = h("button", { type: "button", "data-thumb": q.id, class: answered(state[q.id]) ? "done" : "", "aria-label": `${i + 1}. ${q.text}`, onclick: () => { if (!grid.hidden) gridBtn.click(); show(i); } },
      pic ? h("img", { src: pic.src, alt: "", loading: "lazy" }) : h("span", { class: "num" }, i + 1),
      big ? h("div", { class: "cap" }, `${i + 1}. ${q.text}`) : null);
    return btn;
  }

  function build() {
    const head = h("header", null, h("h1", null, spec.title), spec.intro ? h("p", { class: "intro" }, spec.intro) : null,
      !served ? h("p", { class: "muted no-print" }, data.offline ? "Answer here, then press Save answers file and send the file back, or Copy answers and paste them." : "This page is open without its server, so answers are copied, not sent. Open it from the question-pictures server to send them.") : null);
    app.append(head, bar);
    if (served) {
      const banner = h("div", { class: "banner", hidden: true, role: "alert" }, h("span", { class: "grow" }, "This page has a newer version. Your answers here are kept in this browser."), h("button", { type: "button", onclick: () => location.reload() }, "Load the new page"));
      app.append(banner);
      const check = async () => {
        try {
          const res = await fetch(`/__ask/version/${encodeURIComponent(spec.id)}`, { cache: "no-store" });
          if (res.ok) banner.hidden = (await res.json()).hash === spec.hash;
        } catch { /* the server stopped; nothing to say until it is back */ }
      };
      setInterval(check, 5000);
    }
    if (spec.layout === "table") {
      const tables = new Map();
      for (const q of qs) tables.set(q.table, [...(tables.get(q.table) ?? []), q]);
      for (const [name, rows] of tables) list.append(table(name, rows));
    } else {
      let group = null;
      qs.forEach((q, i) => {
        if (q.group && q.group !== group && spec.layout !== "pages") { list.append(h("h3", { class: "group" }, q.group)); group = q.group; }
        list.append(question(q, i + 1));
      });
    }
    if (spec.layout === "pages") {
      qs.forEach((q, i) => { strip.append(thumb(q, i, false)); grid.append(thumb(q, i, true)); });
      pager.append(prev, pagerText, next, gridBtn, firstOpen);
      app.append(pager, strip, grid, list);
      const start = qs.findIndex((q) => `#${encodeURIComponent(q.id)}` === location.hash);
      show(start >= 0 ? start : 0);
    } else {
      app.append(list);
    }
    app.append(full, keysDialog);
    progress();
    if (data.previous && !store.get()) say(`Answered before, ${String(data.previous.submitted ?? "").replace("T", " ").slice(0, 16)}. Change anything and send again.`, "saved");
  }

  // --- the keyboard ---------------------------------------------------
  const keysDialog = h("dialog", { "aria-label": "Keyboard shortcuts" },
    h("h2", null, "Keyboard"),
    h("table", null, h("tbody", null,
      [["1–9", "Pick that option in the question you are on (0: something else)"], ["← →", "Previous or next page, where the page has pages"], ["j k", "Next or previous question"], ["n", "The next question with no answer"], ["Ctrl+Enter", served ? "Send the answers" : "Copy the answers"], ["?", "This list"], ["Esc", "Close a picture or this list"]]
        .map(([k, what]) => h("tr", null, h("td", null, h("kbd", null, k)), h("td", null, what))))),
    h("button", { type: "button", onclick: () => keysDialog.close() }, "Close"));
  document.addEventListener("focusin", (e) => { const sec = e.target.closest?.("[data-id]"); if (sec) focused = sec.dataset.id; });
  const here = () => (spec.layout === "pages" ? qs[current].id : focused ?? qs[0].id);
  const go = (delta) => {
    if (spec.layout === "pages") return show(current + delta);
    const at = qs.findIndex((q) => q.id === here());
    const q = qs[Math.max(0, Math.min(qs.length - 1, at + delta))];
    focused = q.id;
    sections.get(q.id).focus();
    sections.get(q.id).scrollIntoView({ block: "start" });
  };
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !["radio", "checkbox"].includes(e.target.type);
    if (typing || e.altKey || e.ctrlKey || e.metaKey || document.querySelector("dialog[open]")) return;
    if (/^[0-9]$/.test(e.key)) { sections.get(here())?.pick?.(Number(e.key)); e.preventDefault(); }
    else if (e.key === "ArrowRight" && spec.layout === "pages") { go(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" && spec.layout === "pages") { go(-1); e.preventDefault(); }
    else if (e.key === "j") go(1);
    else if (e.key === "k") go(-1);
    else if (e.key === "n") { const id = openIds()[0]; if (id) { const i = qs.findIndex((q) => q.id === id); if (spec.layout === "pages") show(i); else { focused = id; sections.get(id).focus(); sections.get(id).scrollIntoView({ block: "start" }); } } }
    else if (e.key === "?") keysDialog.showModal();
  });

  build();
})();
