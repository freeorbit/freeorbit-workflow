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
  // The viewer's colours: a palette, and light, dark, or the system's. Kept in this browser for every page.
  const PALETTES = [["orbit", "Orbit"], ["slate", "Slate"], ["forest", "Forest"], ["ember", "Ember"], ["contrast", "High contrast"]];
  const MODES = [["auto", "System"], ["light", "Light"], ["dark", "Dark"]];
  const look = (() => { try { return JSON.parse(localStorage.getItem("wf-ask:look") ?? "{}"); } catch { return {}; } })();
  function applyLook() {
    const root = document.documentElement;
    root.dataset.palette = PALETTES.some(([id]) => id === look.palette) ? look.palette : "orbit";
    if (look.mode === "light" || look.mode === "dark") root.dataset.theme = look.mode;
    else delete root.dataset.theme;
    try { localStorage.setItem("wf-ask:look", JSON.stringify(look)); } catch { /* kept for this visit only */ }
  }
  applyLook();
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
    refreshBulk();
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
    h("span", { class: "look-pick no-print" },
      h("select", { "aria-label": "Colour theme", onchange: (e) => { look.palette = e.target.value; applyLook(); } }, PALETTES.map(([id, label]) => h("option", { value: id, selected: (look.palette ?? "orbit") === id }, label))),
      h("select", { "aria-label": "Light or dark", onchange: (e) => { look.mode = e.target.value; applyLook(); } }, MODES.map(([id, label]) => h("option", { value: id, selected: (look.mode ?? "auto") === id }, label)))),
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
    // The page knows each picture's size, so the space is kept before it loads and nothing jumps.
    const img = h("img", { src: pic.src, alt: pic.name || pic.label || `picture ${index + 1}`, draggable: "false", decoding: "async", width: pic.w || null, height: pic.h || null });
    const node = h("div", { class: `stage${pinnable ? " pinnable" : ""}` }, img);
    if (pic.w && pic.h) node.style.aspectRatio = `${pic.w} / ${pic.h}`;
    const size = () => [pic.w || img.naturalWidth || 1, pic.h || img.naturalHeight || 1];
    const place = () => {
      const [w, ht] = size();
      node.querySelectorAll(".box,.pin").forEach((each) => each.remove());
      for (const box of pic.boxes ?? []) {
        const [x, y, bw, bh] = box.rect;
        const el = h("div", { class: "box", title: box.text || box.kind, style: { left: `${(x / w) * 100}%`, top: `${(y / ht) * 100}%`, width: `${(bw / w) * 100}%`, height: `${(bh / ht) * 100}%` } }, h("span", null, box.n));
        el.style.setProperty("--c", colour(box.kind));
        node.append(el);
      }
      (state[q.id]?.pins ?? []).forEach((pin, i) => {
        if (pin.picture !== index) return;
        const dot = h("div", { class: "pin", title: pin.text, style: { left: `${(pin.x / w) * 100}%`, top: `${(pin.y / ht) * 100}%` } }, i + 1);
        dot.style.setProperty("--c", colour(pin.kind));
        node.append(dot);
      });
    };
    if (pic.w && pic.h) place();
    else img.addEventListener("load", place, { once: true });
    node.place = place;
    node.zoom = (zoom) => node.style.setProperty("--w", zoom === "fit" ? "100%" : `${size()[0] * Number(zoom)}px`);
    if (pinnable) {
      node.addEventListener("click", (event) => {
        const rect = img.getBoundingClientRect();
        const [w, ht] = size();
        const x = ((event.clientX - rect.left) / rect.width) * w;
        const y = ((event.clientY - rect.top) / rect.height) * ht;
        const box = (pic.boxes ?? []).find((b) => x >= b.rect[0] && x <= b.rect[0] + b.rect[2] && y >= b.rect[1] && y <= b.rect[1] + b.rect[3]);
        sections.get(q.id)?.askPin({ picture: index, x, y, box: box?.n });
      });
    }
    return node;
  }
  function figure(q, pic, index, pinnable) {
    const st = stage(q, pic, index, pinnable);
    const fig = h(
      "figure",
      { class: "pic" },
      h("figcaption", null, pic.label ? h("span", { class: "label" }, pic.label) : null, h("span", { class: "grow" }, pic.name || ""), h("button", { type: "button", onclick: () => showFull(pic), "aria-label": `Full size: ${pic.name || pic.label || "picture"}` }, "Full size")),
      h("div", { class: "scroll" }, st),
    );
    fig.stage = st;
    return fig;
  }

  // Every view of a pair is built once; a mode only shows one and hides the rest.
  function compareView(q, offset) {
    const [a, b] = q.compare;
    const left = figure(q, a, offset, q.pins);
    const right = figure(q, b, offset + 1, q.pins);
    const side = h("div", { class: "side" }, left, right);
    const base = stage(q, b, offset + 1, false);
    const top = stage(q, a, offset, false);
    top.classList.add("top");
    const divider = h("div", { class: "divider", "aria-hidden": "true" }, h("span", { class: "grip" }, "⇆"));
    const over = h("div", { class: "over swipe" }, base, top, divider);
    const note = h("p", { class: "muted" });
    const overWrap = h("div", { class: "scroll" }, over);
    const slider = h("input", { type: "range", min: "0", max: "100", step: "0.5", value: "50", "aria-label": `How much of ${a.label || "the first picture"} shows` });
    const at = (value) => {
      slider.value = String(value);
      over.style.setProperty("--at", `${value}%`);
      over.style.setProperty("--op", String(value / 100));
    };
    slider.addEventListener("input", () => at(Number(slider.value)));
    at(50);
    // Drag anywhere on the swipe to move its line, as on a phone.
    let dragging = false;
    const follow = (event) => {
      const rect = over.getBoundingClientRect();
      at(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)));
    };
    over.addEventListener("pointerdown", (event) => {
      if (!over.classList.contains("swipe") && !over.classList.contains("onion")) return;
      dragging = true;
      over.setPointerCapture(event.pointerId);
      if (over.classList.contains("swipe")) follow(event);
    });
    over.addEventListener("pointermove", (event) => { if (dragging && over.classList.contains("swipe")) requestAnimationFrame(() => follow(event)); });
    over.addEventListener("pointerup", () => { dragging = false; });
    over.addEventListener("pointercancel", () => { dragging = false; });
    // Side by side scrolls as one.
    const panes = [left.querySelector(".scroll"), right.querySelector(".scroll")];
    let leader = null;
    panes.forEach((pane) => {
      pane.addEventListener("pointerenter", () => { leader = pane; });
      pane.addEventListener("scroll", () => {
        if (leader && leader !== pane) return;
        const other = panes.find((x) => x !== pane);
        other.scrollTop = pane.scrollTop;
        other.scrollLeft = pane.scrollLeft;
      }, { passive: true });
    });
    const notes = {
      swipe: `${a.label || "First"} on the left of the line, ${b.label || "second"} on the right. Drag across the picture, or use the slider.`,
      onion: `${a.label || "First"} faded over ${b.label || "second"}. The slider sets how much shows.`,
      diff: "What is the same goes dark; what differs lights up.",
    };
    let mode = "side";
    const modes = [["side", "Side by side"], ["swipe", "Swipe"], ["onion", "Onion skin"], ["diff", "Difference"]];
    const buttons = modes.map(([id, label]) => h("button", { type: "button", "aria-pressed": String(id === mode), onclick: () => setMode(id) }, label));
    function setMode(id) {
      mode = id;
      buttons.forEach((btn, i) => btn.setAttribute("aria-pressed", String(modes[i][0] === mode)));
      side.hidden = mode !== "side";
      overWrap.hidden = mode === "side";
      note.hidden = mode === "side";
      slider.hidden = mode !== "swipe" && mode !== "onion";
      over.className = `over ${mode}`;
      note.textContent = notes[mode] ?? "";
      if (mode !== "side") note.append(" Pins go on the side-by-side view.");
    }
    const zoomSelect = h("select", { "aria-label": "Zoom", style: { width: "auto" }, onchange: (e) => [left.stage, right.stage, base, top].forEach((s) => s.zoom(e.target.value)) }, h("option", { value: "fit" }, "Fit"), h("option", { value: "1" }, "100%"), h("option", { value: "2" }, "200%"));
    const wrap = h("div", { class: "compare" }, h("div", { class: "modes", role: "group", "aria-label": "How to compare" }, buttons, zoomSelect, slider), note, side, overWrap);
    setMode("side");
    return wrap;
  }

  // --- selecting for bulk answers ------------------------------------
  const selected = new Set();
  let refreshBulk = () => {};
  function selBox(id, label) {
    const box = h("input", { type: "checkbox", class: "sel", "data-sel": id, "aria-label": `Select ${label} for a bulk answer` });
    box.addEventListener("change", () => { box.checked ? selected.add(id) : selected.delete(id); refreshBulk(); });
    return box;
  }
  const setSelected = (id, on) => {
    on ? selected.add(id) : selected.delete(id);
    document.querySelectorAll(`[data-sel="${CSS.escape(id)}"]`).forEach((b) => { b.checked = on; });
  };

  // --- one question -----------------------------------------------------
  function question(q, number) {
    const sec = h("section", { class: "q", id: `q-${q.id}`, tabindex: "-1", "aria-labelledby": `t-${q.id}`, "data-id": q.id });
    sections.set(q.id, sec);
    const v = () => entry(q.id);
    const headerRow = h(
      "header",
      null,
      q.type === "rank" ? null : selBox(q.id, `question ${number}`),
      h("h2", { id: `t-${q.id}` }, `${number}. ${q.text}`),
      q.role ? h("span", { class: "chip" }, q.role) : null,
      h("span", { class: "chip" }, q.id),
    );
    sec.append(headerRow);
    if (q.detail) sec.append(h("p", { class: "detail muted" }, q.detail));
    if (q.look) sec.append(h("p", { class: "look" }, h("strong", null, "Where to look: "), q.look));
    if (q.noPick) sec.append(h("p", { class: "why" }, h("strong", null, "No recommendation: "), q.noPick));
    else if (q.why && q.type === "rank") sec.append(h("p", { class: "why" }, h("strong", null, "Suggested order, as listed: "), q.why));
    else if (q.why && q.recommended != null) sec.append(h("p", { class: "why" }, h("strong", null, "Why the recommendation: "), q.why));
    if (q.pictures.length) {
      const pics = h("div", { class: "pics" }, q.pictures.map((pic, i) => figure(q, pic, i, q.pins)));
      sec.append(pics);
    }
    if (q.compare) sec.append(compareView(q, q.pictures.length));

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
      sec.setChoice = (ids) => {
        const plain = inputs.filter((x) => x !== otherBox);
        if (q.type === "many") plain.forEach((x) => { x.checked = ids.includes(x.value); });
        const first = plain.find((x) => ids.includes(x.value));
        if (!first) return;
        first.checked = true;
        first.dispatchEvent(new Event("change"));
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
        sec.decide = (which) => { const b = deciders.find((d) => d.dataset.id === which); if (b && b.getAttribute("aria-pressed") !== "true") b.click(); };
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
    return sec;
  }

  // --- a table of rows (testdata) ----------------------------------------
  function allBox(ids, name) {
    const box = h("input", { type: "checkbox", "aria-label": `Select every row of ${name}` });
    box.addEventListener("change", () => { ids.forEach((id) => setSelected(id, box.checked)); refreshBulk(); });
    return box;
  }
  function table(name, rows) {
    const columns = rows[0].columns.length ? rows[0].columns : ["Row"];
    const opts = rows[0].options;
    const body = h("tbody");
    for (const q of rows) {
      const tr = h("tr", { id: `q-${q.id}`, "data-id": q.id, tabindex: "-1" });
      sections.set(q.id, tr);
      tr.append(h("td", null, selBox(q.id, `row ${q.text}`)));
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
      tr.setChoice = (ids) => { const input = inputs.find((x) => ids.includes(x.value)); if (input) { input.checked = true; input.dispatchEvent(new Event("change")); } };
      const note = h("input", { type: "text", placeholder: "Note", "aria-label": `Note on ${q.text}`, value: state[q.id]?.note ?? "" });
      note.addEventListener("input", () => { entry(q.id).note = note.value; changed(q.id); });
      tr.append(radios, h("td", null, note));
      tr.classList.toggle("done", answered(state[q.id]));
      body.append(tr);
    }
    return h("div", null, h("h3", { class: "group" }, name), h("div", { class: "wrap" }, h("table", { class: "rows" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, allBox(rows.map((r) => r.id), name)), columns.map((c) => h("th", { scope: "col" }, c)), h("th", { scope: "col" }, "Verdict"), h("th", { scope: "col" }, "Note"))), body)));
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

  // --- bulk answers ---------------------------------------------------
  // Each applies to the selected questions, or, with none selected, to every
  // open one, and never overwrites an answer unless it was selected. Undo
  // puts back the answers from before.
  function bulkBar() {
    const choosable = qs.filter((q) => q.type === "one" || q.type === "many");
    const recs = choosable.filter((q) => q.recommended != null);
    // The option set most questions share, such as a review's verdicts.
    const sets = new Map();
    for (const q of choosable.filter((x) => x.type === "one")) {
      const key = q.options.map((o) => o.id).join("\u0000");
      sets.set(key, [...(sets.get(key) ?? []), q]);
    }
    const shared = [...sets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const verdicts = shared.length >= 2 ? shared[0].options : [];
    const sharedIds = new Set(shared.map((q) => q.id));
    const deferrable = qs.some((q) => q.defer);
    if (!recs.length && !verdicts.length && !deferrable) return null;
    const target = (fits) => {
      const pool = selected.size ? qs.filter((q) => selected.has(q.id)) : qs.filter((q) => !answered(state[q.id]));
      return pool.filter(fits);
    };
    const info = h("span", { class: "muted" });
    let undo = null;
    const undoBtn = h("button", { type: "button", hidden: true, onclick: () => { if (undo) { store.set(undo); location.reload(); } } }, "Undo");
    const apply = (fits, act, what) => {
      const hit = target(fits);
      if (!hit.length) return say(`Nothing to ${what}: no ${selected.size ? "selected" : "open"} question takes it.`, "");
      undo = structuredClone(state);
      hit.forEach(act);
      undoBtn.hidden = false;
      say(`${what[0].toUpperCase()}${what.slice(1)} on ${hit.length} ${hit.length === 1 ? "question" : "questions"}.`, "");
      [...selected].forEach((id) => setSelected(id, false));
      refreshBulk();
    };
    const buttons = [];
    if (recs.length) buttons.push(h("button", { type: "button", onclick: () => apply((q) => q.recommended != null, (q) => sections.get(q.id).setChoice(Array.isArray(q.recommended) ? q.recommended : [q.recommended]), "took the recommendation") }, "Take every recommendation"));
    if (verdicts.length) {
      buttons.push(h("span", { class: "muted" }, "Mark as:"));
      for (const opt of verdicts) buttons.push(h("button", { type: "button", onclick: () => apply((q) => sharedIds.has(q.id), (q) => sections.get(q.id).setChoice([opt.id]), `marked “${opt.label}”`) }, opt.kind ? h("span", { class: "swatch", style: { background: colour(opt.kind) } }) : null, opt.label));
    }
    if (deferrable) {
      buttons.push(h("button", { type: "button", onclick: () => apply((q) => q.defer, (q) => sections.get(q.id).decide?.("agent"), "left it to the agent") }, "You decide"));
      buttons.push(h("button", { type: "button", onclick: () => apply((q) => q.defer, (q) => sections.get(q.id).decide?.("later"), "kept it for later") }, "Later"));
    }
    const selectOpen = h("button", { type: "button", onclick: () => { qs.filter((q) => !answered(state[q.id]) && q.type !== "rank").forEach((q) => setSelected(q.id, true)); refreshBulk(); } }, "Select open");
    const clear = h("button", { type: "button", onclick: () => { [...selected].forEach((id) => setSelected(id, false)); refreshBulk(); } }, "Clear");
    refreshBulk = () => {
      const open = qs.filter((q) => !answered(state[q.id])).length;
      info.textContent = selected.size ? `For the ${selected.size} selected:` : `For every open question (${open}):`;
      clear.hidden = !selected.size;
    };
    refreshBulk();
    return h("div", { class: "bulk no-print", role: "group", "aria-label": "Answer many at once" }, info, buttons, undoBtn, h("span", { class: "grow" }), selectOpen, clear);
  }

  function build() {
    const head = h("header", null, h("h1", null, spec.title), spec.intro ? h("p", { class: "intro" }, spec.intro) : null,
      !served ? h("p", { class: "muted no-print" }, data.offline ? "Answer here, then press Save answers file and send the file back, or Copy answers and paste them." : "This page is open without its server, so answers are copied, not sent. Open it from the question-pictures server to send them.") : null);
    app.append(head, bar);
    const bulkSlot = h("div");
    app.append(bulkSlot);
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
    const bulk = bulkBar();
    if (bulk) bulkSlot.append(bulk);
    progress();
    if (data.previous && !store.get()) say(`Answered before, ${String(data.previous.submitted ?? "").replace("T", " ").slice(0, 16)}. Change anything and send again.`, "saved");
  }

  // --- the keyboard ---------------------------------------------------
  const keysDialog = h("dialog", { "aria-label": "Keyboard shortcuts" },
    h("h2", null, "Keyboard"),
    h("table", null, h("tbody", null,
      [["1–9", "Pick that option in the question you are on (0: something else)"], ["← →", "Previous or next page, where the page has pages"], ["j k", "Next or previous question"], ["n", "The next question with no answer"], ["x", "Select the question you are on for a bulk answer"], ["Ctrl+Enter", served ? "Send the answers" : "Copy the answers"], ["?", "This list"], ["Esc", "Close a picture or this list"]]
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
    else if (e.key === "x") { const id = here(); const on = !selected.has(id); if (document.querySelector(`[data-sel="${CSS.escape(id)}"]`)) { setSelected(id, on); refreshBulk(); } }
    else if (e.key === "?") keysDialog.showModal();
  });

  build();
})();
