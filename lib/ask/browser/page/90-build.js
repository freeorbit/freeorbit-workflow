// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
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
    // A live page's status comes first, then what changed and the agent's replies.
    if (liveCard) { questionsView.append(liveCard); drawLive(); }
    const changeNote = changesNotice();
    if (changeNote) questionsView.append(changeNote);
    questionsView.append(repliesNotice);
    // The questions go where the page's questions blocks are, or after its blocks.
    const runOf = (list) => {
      // Each run of questions under one group is a section of its own, so it can be set apart.
      let group;
      let section = null;
      const out = h("div", { class: "sections" });
      for (const q of list) {
        if (!section || (!pages && (q.group || "") !== group)) {
          group = q.group || "";
          section = h("section", { class: "section", "aria-label": group || null }, !pages && group ? h("div", { class: "group-label" }, group) : null);
          out.append(section);
        }
        section.append(question(q, qs.indexOf(q) + 1));
      }
      return out;
    };
    const qHost = h("div", { class: "questions-host" });
    qHost.append(toolbar);
    let hostFor;
    if (table) {
      const groups = new Map();
      for (const q of qs) groups.set(q.table, [...(groups.get(q.table) ?? []), q]);
      for (const [name, rows] of groups) qHost.append(...tableOf(name, rows));
    } else if (pages) {
      qHost.append(h("div", { class: "pager" }, prevBtn, pagerText, nextBtn, h("span", { class: "grow" }), gridBtn),
        h("div", { class: "pages-strip" }, strip), grid, runOf(qs));
      qs.forEach((q, i) => { strip.append(thumbOf(q, i, false)); grid.append(thumbOf(q, i, true)); });
    } else if (spec.sections) {
      // Each questions block holds the questions it places; the toolbar sits with the first.
      let first = true;
      hostFor = (b) => {
        const host = first ? qHost : h("div", { class: "questions-host" });
        first = false;
        host.append(runOf(qs.filter((q) => (b.ids ?? qs.map((x) => x.id)).includes(q.id))));
        return host;
      };
    } else qHost.append(runOf(qs));
    if (spec.sections) {
      let used = false;
      const wrap = drawSections(spec.sections, hostFor ?? (() => { if (used) return h("div"); used = true; return qHost; }));
      if (spec.steps) questionsView.append(stepper(wrap));
      questionsView.append(wrap);
    } else questionsView.append(qHost);
    app.append(full, keysDialog, palette, historyDialog);
    qs.forEach((q) => uis.get(q.id)?.sync());
    refresh();
    toolbarRefresh();
    const pos = session.get(`wf-ask:pos:${key}:${spec.id}`);
    const fromHash = qs.find((q) => `#${encodeURIComponent(q.id)}` === location.hash)?.id;
    const start = fromHash ?? pos?.id ?? (qs.find(isOpen) ?? qs[0])?.id;
    // A status page has nothing to answer: no footer, no count, no toolbar.
    if (!qs.length) { footer.hidden = true; progressPill.hidden = true; toolbar.hidden = true; document.documentElement.dataset.status = "1"; }
    else if (pages) { showPage(qs.findIndex((q) => q.id === start)); }
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
      // A live page is read often while it runs; replies are read less often.
      if (spec.live || repliesOn) { pollLive(); setInterval(pollLive, spec.live ? 2500 : 6000); }
    }
  }
  build();
})();
