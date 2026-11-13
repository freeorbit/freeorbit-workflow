// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, in order: the frame (helpers, the
// look, the answers and undo, header, popovers, outline, settings),
// pictures, a question, bulk answers, moving around, sending, other asks
// with the command palette and keys, and building the page.
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
        if (pin.picture !== index) return;
        if (pin.w) node.append(h("div", { class: "pin region", "data-pin": i, title: pin.text, style: { left: `${(pin.x / w) * 100}%`, top: `${(pin.y / ht) * 100}%`, width: `${(pin.w / w) * 100}%`, height: `${(pin.h / ht) * 100}%`, "--c": colour(pin.kind) } }, h("span", null, i + 1)));
        else node.append(h("div", { class: "pin", "data-pin": i, title: pin.text, style: { left: `${(pin.x / w) * 100}%`, top: `${(pin.y / ht) * 100}%`, "--c": colour(pin.kind) } }, i + 1));
      });
    };
    node.zoom = () => { const [w, ht] = size(); node.style.setProperty("--w", zoom === "fit" ? `min(100%, calc(72vh * ${w} / ${ht}))` : `${w * Number(zoom)}px`); };
    if (pic.w && pic.h) node.place(); else img.addEventListener("load", node.place, { once: true });
    node.zoom();
    stages.add(node);
    if (pinnable) {
      // In comment mode a click drops a pin; a drag draws a box, unless boxes are turned off.
      const at = (e) => {
        const r = img.getBoundingClientRect();
        const [w, ht] = size();
        return [Math.max(0, Math.min(w, ((e.clientX - r.left) / r.width) * w)), Math.max(0, Math.min(ht, ((e.clientY - r.top) / r.height) * ht))];
      };
      const boxAt = (x, y) => (pic.boxes ?? []).find((b) => x >= b.rect[0] && x <= b.rect[0] + b.rect[2] && y >= b.rect[1] && y <= b.rect[1] + b.rect[3]);
      let start = null;
      let ghost = null;
      const reset = () => { start = null; ghost?.remove(); ghost = null; };
      node.addEventListener("pointerdown", (e) => {
        if (!uis.get(q.id)?.commenting || e.button !== 0) return;
        e.preventDefault();
        start = { p: at(e), cx: e.clientX, cy: e.clientY };
        node.setPointerCapture(e.pointerId);
      });
      node.addEventListener("pointermove", (e) => {
        if (!start || off.has("regions") || Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 6) return;
        const [w, ht] = size();
        const [x, y] = at(e);
        ghost ??= node.appendChild(h("div", { class: "region ghost", style: { "--c": colour("look") } }));
        const [x0, y0] = start.p;
        Object.assign(ghost.style, { left: `${(Math.min(x, x0) / w) * 100}%`, top: `${(Math.min(y, y0) / ht) * 100}%`, width: `${(Math.abs(x - x0) / w) * 100}%`, height: `${(Math.abs(y - y0) / ht) * 100}%` });
      });
      node.addEventListener("pointerup", (e) => {
        if (!start) return;
        const moved = Math.hypot(e.clientX - start.cx, e.clientY - start.cy) >= 6 && !off.has("regions");
        const [x0, y0] = start.p;
        const [x, y] = at(e);
        reset();
        if (!moved) {
          const box = boxAt(x0, y0);
          uis.get(q.id)?.askPin({ picture: index, x: Math.round(x0), y: Math.round(y0), ...(box ? { box: box.n } : {}) });
          return;
        }
        const left = Math.min(x, x0);
        const top = Math.min(y, y0);
        const box = boxAt(left + Math.abs(x - x0) / 2, top + Math.abs(y - y0) / 2);
        uis.get(q.id)?.askPin({ picture: index, x: Math.round(left), y: Math.round(top), w: Math.max(1, Math.round(Math.abs(x - x0))), h: Math.max(1, Math.round(Math.abs(y - y0))), ...(box ? { box: box.n } : {}) });
      });
      node.addEventListener("pointercancel", reset);
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
      let mode = session.get("wf-ask:compare") ?? "swipe";
      const modes = [["side", "Side by side"], ["swipe", "Swipe"], ["onion", "Onion"], ["diff", "Difference"]];
      const seg = h("div", { class: "seg", role: "group", "aria-label": "How to compare" }, modes.map(([id, label]) => h("button", { type: "button", "data-mode": id, onclick: () => setMode(id) }, label)));
      const note = h("p", { class: "muted small view-note" });
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
        if (commentBtn) commentBtn.textContent = mode === "side" ? "Comment" : "Comment (side by side)";
      }
      bar.append(...[seg, slider, sizeNote, h("span", { class: "grow" }), zoomSelect(), commentBtn].filter(Boolean));
      body.append(note, pair, over);
      // With compare turned off, a pair is only side by side.
      if (off.has("compare")) { mode = "side"; seg.hidden = true; }
      setMode(mode);
      ui.cycleCompare = () => setMode(modes[(modes.findIndex(([id]) => id === mode) + 1) % modes.length][0]);
      // Pins go on the side-by-side view, so comment mode moves there first.
      ui.toSide = () => { if (mode !== "side") setMode("side"); };
    } else {
      const figs = q.pictures.map((pic, i) => h("figure", { class: "pic" },
        h("figcaption", null, pic.label ? h("b", null, pic.label) : null, h("span", { class: "grow" }, pic.name || ""), pic.w ? h("span", { class: "num" }, `${pic.w}×${pic.h}`) : null, h("button", { class: "ghost", type: "button", onclick: () => showFull(pic) }, "Full size")),
        stage(q, pic, i, q.pins)));
      body.append(figs.length > 1 ? h("div", { class: "pair" }, figs) : figs[0]);
      bar.append(...[h("span", { class: "muted small" }, all.length > 1 ? `${all.length} pictures` : ""), h("span", { class: "grow" }), zoomSelect(), commentBtn].filter(Boolean));
    }
    ui.commentBtn = commentBtn;
    return box;
  }

