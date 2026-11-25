// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts are listed at pageScript
// in lib/ask/page.mjs.
  // --- working together, on a team server ---------------------------------------------
  // One shared answer per question: each pick or note is saved as it is made
  // (POST /__ask/<key>/answer/<id>) and comes to every other open page over
  // one event stream (/__ask/<key>/events/<id>), which says only what changed.
  // With it: who is on the page and where, who types, a warning when someone
  // changes what you are writing, who answered each question, threads,
  // assigning, a ready check, who sent it, and what happened.
  // lib/team/collab.mjs is the server's side. Off a team server,
  // data.collab is not there and none of this runs.

  const together = served && data.collab ? data.collab : null;
  const me = together?.me ?? null;
  const conn = Math.random().toString(36).slice(2, 12);
  const sig = (v) => JSON.stringify(v && Object.keys(v).length ? v : null);
  let people = [];
  let by = { ...(data.working?.by ?? {}) };
  let at = { ...(data.working?.at ?? {}) };
  let threads = together?.threads ?? {};
  let assign = together?.assign ?? {};
  let doneBy = together?.done ?? {};
  let sentNote = together?.sent ?? null;
  let activity = together?.activity ?? [];
  let applyingRemote = false;
  // Each question's answer as the server has it, so a change here, however it was made, is saved.
  const known = new Map(qs.map((q) => [q.id, sig(data.working?.answers?.[q.id])]));
  const pending = new Map(); // question → timer of a save not made yet (null while it waits on a choice)
  const conflicts = new Map(); // question → the answer someone else gave while you wrote yours
  const failed = new Map(); // question → the last reason a save was refused, said once

  const initials = (name) => { const parts = name.split(/[._-]/).filter(Boolean); return (parts.length > 1 ? parts.map((p) => p[0]).join("") : name).slice(0, 2).toUpperCase(); };
  const tone = (name) => { let n = 0; for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) % 360; return `hsl(${n} 55% 45%)`; };
  const qName = (id) => { const q = byId.get(id); return q ? `${qs.indexOf(q) + 1}. ${q.text}` : id; };
  const post = (what, body) => fetch(`/__ask/${encodeURIComponent(key)}/${what}/${encodeURIComponent(spec.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token, "X-WF-Conn": conn }, body: JSON.stringify({ hash: spec.hash, ...body }) });
  const errorOf = async (res) => (await res.json().catch(() => ({}))).error ?? res.status;
  const names = (text) => new Set([...text.matchAll(/@([A-Za-z0-9._-]+)/g)].map((m) => m[1].replace(/[._-]+$/, "")));

  // --- saving each answer as it is made --------------------------------------------------
  /** The answers changed here, by any control, bulk answer, or undo: each that differs from the server's is saved, a moment after its last change. */
  function collabSync() {
    if (!together || applyingRemote) return;
    for (const q of qs) {
      if (sig(A[q.id]) === known.get(q.id) && !pending.has(q.id)) continue;
      clearTimeout(pending.get(q.id));
      pending.set(q.id, setTimeout(() => saveNow(q.id), 500));
    }
  }
  /** A question's answer, less form values the page shows as wrong, which stay here to fix. */
  function valueOf(id) {
    const q = byId.get(id);
    const v = A[id] && Object.keys(A[id]).length ? structuredClone(A[id]) : null;
    if (v?.fields) for (const f of q.fields) if (v.fields[f.id] != null && S.fieldProblem(f, v.fields[f.id])) delete v.fields[f.id];
    return v;
  }
  async function saveNow(id, keepMine = false) {
    clearTimeout(pending.get(id));
    // Someone changed it while you wrote: it waits until you choose.
    if (conflicts.has(id) && !keepMine) { pending.set(id, null); return; }
    pending.delete(id);
    conflicts.delete(id);
    const value = valueOf(id);
    if (sig(value) === known.get(id)) { uis.get(id)?.drawCollab?.(); return; }
    try {
      const res = await post("answer", { question: id, value });
      // Too many changes this minute: kept here, and saved again in a little while.
      if (res.status === 429) { if (!pending.has(id)) pending.set(id, setTimeout(() => saveNow(id), 5000)); return; }
      if (!res.ok) {
        const why = await errorOf(res);
        if (failed.get(id) !== why) toast(`Not saved for everyone: ${why}`);
        failed.set(id, why);
        return;
      }
      failed.delete(id);
      const body = await res.json();
      // What the server kept, which may differ, such as a follow-up that answer no longer asks.
      apply(body.changes ?? {}, body.by ?? {}, body.when ?? {});
      savedEl.hidden = false;
      savedEl.className = "saved on";
      savedEl.textContent = `Saved for everyone · ${clock()}`;
    } catch {
      toast("Can't reach the server; this answer is kept here and saved when it is back.");
      if (!pending.has(id)) pending.set(id, setTimeout(() => saveNow(id), 5000));
    }
  }
  /** Every save not made yet, now, before a send, so it carries them; or why the send waits. */
  async function collabFlush() {
    if (!together) return "";
    if (conflicts.size) return `Choose Use theirs or Keep mine on ${[...conflicts.keys()].map(qName).join(", ")} first.`;
    await Promise.all([...pending.keys()].map((id) => saveNow(id)));
    return "";
  }

  // --- answers others give ------------------------------------------------------------------
  /** Whether you are writing in a question's own words right now: its note, text, or other. */
  const writing = (id) => {
    const el = document.activeElement;
    return Boolean(el && uis.get(id)?.el.contains(el) && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text")));
  };
  /**
   * Answers as the server has them now, for these questions: laid over yours,
   * but where you are writing or have a change not saved yet, where you are
   * told and choose.
   */
  function apply(changes, byNow, atNow, who = null) {
    applyingRemote = true;
    try {
      const ids = Object.keys(changes).filter((id) => byId.has(id));
      for (const id of ids) {
        const theirs = changes[id];
        known.set(id, sig(theirs));
        if (theirs == null) { delete by[id]; delete at[id]; } else { if (byNow[id]) by[id] = byNow[id]; if (atNow[id]) at[id] = atNow[id]; }
        if (sig(A[id]) === sig(theirs)) { conflicts.delete(id); continue; }
        // Yours, changed since it was sent, or being written: kept, and when it is someone else's change, you choose.
        if (pending.has(id) || writing(id)) {
          if (who) { conflicts.set(id, { value: theirs ?? null, who }); uis.get(id)?.drawCollab?.(); }
          continue;
        }
        if (theirs == null) delete A[id];
        else A[id] = structuredClone(theirs);
      }
      if (!ids.length) return;
      for (const id of ids) uis.get(id)?.sync();
      // Follow-ups may come or go with these answers.
      for (const q of qs) if (q.showIf && !ids.includes(q.id)) uis.get(q.id)?.sync();
      refresh();
    } finally {
      applyingRemote = false;
    }
  }

  // --- each question's part ---------------------------------------------------------------
  /** Who answered it and when, who is on it, the thread, who it is for, a link, and a warning when it changed under you. */
  function collabFor(q, ui, body) {
    if (!together) return;
    const who = h("span", { class: "who-chip", hidden: true });
    const here = h("span", { class: "here-chips" });
    const forWho = h("span", { class: "chip for-chip", hidden: true });
    ui.el.querySelector(".q-head").append(here, who, forWho);
    const conflict = h("div", { class: "collab-conflict", role: "alert", hidden: true });
    const meta = body.querySelector(".meta") ?? body;
    // Assigning is the team's; a client sees who a question is for.
    const assignSel = me.client ? null : h("select", { class: "pick assign-pick", "aria-label": `Assign ${q.text} to`, onchange: async (e) => {
      const res = await post("assign", { question: q.id, name: e.target.value || null });
      if (!res.ok) toast(`Not assigned: ${await errorOf(res)}`);
    } }, h("option", { value: "" }, "Assign to…"), (together.people ?? []).map((p) => h("option", { value: p.name }, `${p.name} (${p.role})`)));
    const link = h("button", { class: "ghost", type: "button", title: "Copy a link to this question", onclick: async () => toast((await copyText(`${location.origin}${location.pathname}#${encodeURIComponent(q.id)}`)) ? "Copied a link to this question." : "Could not copy.") }, "Link");
    const talkBtn = h("button", { class: "ghost talk-btn", type: "button", "aria-expanded": "false", onclick: () => { talk.hidden = !talk.hidden; talkBtn.setAttribute("aria-expanded", String(!talk.hidden)); if (!talk.hidden) said.focus(); } }, "Discuss");
    meta.append(...[assignSel, talkBtn, link].filter(Boolean));
    const list = h("ol", { class: "talk-list" });
    const said = h("textarea", { rows: "2", maxlength: "2000", placeholder: "Say something to the others; @name tells them", "aria-label": `Discuss ${q.text}` });
    const sayBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const text = said.value.trim();
      if (!text) return;
      const res = await post("thread", { question: q.id, text });
      if (!res.ok) { toast(`Not posted: ${await errorOf(res)}`); return; }
      said.value = "";
    } }, "Post");
    const talk = h("div", { class: "talk", hidden: true }, list, h("div", { class: "note" }, said), h("div", { class: "acts" }, h("span", { class: "grow" }), sayBtn));
    body.append(conflict, talk);
    /** Open the discussion with these words to start a line, such as @name. */
    ui.openTalk = (start) => {
      talk.hidden = false;
      talkBtn.setAttribute("aria-expanded", "true");
      if (!said.value.startsWith(start)) said.value = `${start}${said.value}`;
      go(q.id, true);
      said.focus();
    };
    /** A line's words with each @name of someone who sees the page set apart. */
    const words = (text) => text.split(/(@[A-Za-z0-9._-]+)/).map((part) => (part.startsWith("@") && (together.people ?? []).some((p) => p.name === part.slice(1).replace(/[._-]+$/, "")) ? h("b", { class: "mention" }, part) : part));
    /** Who else is on this question, and whether they type. */
    ui.drawHere = () => {
      const on = people.filter((p) => p.question === q.id && p.name !== me.name);
      here.replaceChildren(...on.map((p) => h("span", { class: "here", title: `${p.name}${p.typing ? " is writing" : " is here"}`, style: { "--c": tone(p.name) } }, initials(p.name), p.typing ? h("span", { class: "typing" }, "…") : null)));
      ui.el.classList.toggle("others-here", on.length > 0);
      if (on.length) ui.el.style.setProperty("--here", tone(on[0].name));
    };
    ui.drawTalk = () => {
      const line = threads[q.id] ?? [];
      talkBtn.textContent = line.length ? `Discuss (${line.length})` : "Discuss";
      list.replaceChildren(...line.map((t) => h("li", null, h("span", { class: "who", style: { "--c": tone(t.by) } }, t.by), " ", ...words(t.text), " ", h("span", { class: "muted small", title: t.at }, ago(t.at)))));
    };
    ui.drawAssign = () => {
      const a = assign[q.id];
      forWho.hidden = !a;
      forWho.textContent = a ? `For ${a.name === me.name ? "you" : a.name}` : "";
      if (assignSel) assignSel.value = a?.name ?? "";
    };
    /** Who answered it, and a warning when it changed under you; with the rest when drawn whole. */
    ui.drawCollab = (whole = false) => {
      const name = by[q.id];
      who.hidden = !name || !A[q.id];
      who.textContent = name ? `${name === me.name ? "You" : name}${at[q.id] ? ` · ${ago(at[q.id])}` : ""}` : "";
      const c = conflicts.get(q.id);
      conflict.hidden = !c;
      if (c) conflict.replaceChildren(
        h("span", { class: "grow" }, `${c.who} changed this answer while you were writing yours: ${c.value ? summary(q, c.value, true) : "cleared it"}.`),
        h("button", { class: "btn", type: "button", onclick: () => {
          applyingRemote = true;
          if (c.value) A[q.id] = structuredClone(c.value);
          else delete A[q.id];
          applyingRemote = false;
          clearTimeout(pending.get(q.id));
          pending.delete(q.id);
          conflicts.delete(q.id);
          ui.sync();
          refresh();
        } }, "Use theirs"),
        h("button", { class: "btn primary", type: "button", onclick: () => saveNow(q.id, true) }, "Keep mine"));
      if (whole) { ui.drawHere(); ui.drawTalk(); ui.drawAssign(); }
    };
  }

  // --- who is on the page ---------------------------------------------------------------------
  const avatars = h("span", { class: "avatars", "aria-label": "On this page" });
  if (together) header.querySelector(".row").insertBefore(avatars, menuBtn);
  // Clicking someone takes you to their question and follows them there; a second click stops.
  let following = null;
  function drawPeople(before = []) {
    if (following && !people.some((p) => p.name === following)) following = null;
    const them = people.find((p) => p.name === following);
    if (them?.question && them.question !== current && uis.get(them.question)) go(them.question, true);
    avatars.replaceChildren(...people.map((p) => h("button", {
      class: `avatar ${p.name === me.name ? "me" : ""} ${p.name === following ? "following" : ""}`, type: "button", style: { "--c": tone(p.name) },
      "aria-pressed": p.name === me.name ? null : String(p.name === following),
      title: `${p.name === me.name ? "You" : p.name} (${p.role})${p.question ? `, on ${qName(p.question)}` : ""}${p.typing ? ", writing" : ""}${p.name === me.name ? "" : p.name === following ? ". Following; click to stop" : ". Click to follow"}`,
      onclick: () => {
        if (p.name === me.name) return;
        following = following === p.name ? null : p.name;
        toast(following ? `Following ${p.name}.` : `Stopped following ${p.name}.`);
        drawPeople();
      },
    }, initials(p.name))));
    // Only the questions someone came to or left are drawn again.
    const touched = new Set([...before, ...people].map((p) => p.question).filter(Boolean));
    for (const id of touched) uis.get(id)?.drawHere?.();
  }
  // Where you are, and whether you type, said when it changes and every 15 s, while the page is in view.
  let where = "";
  let typingUntil = 0;
  let typingAt = null;
  async function sayWhere(force = false) {
    const typing = Date.now() < typingUntil;
    const now = JSON.stringify([current, typing]);
    if (!force && now === where) return;
    where = now;
    try { await post("presence", { question: typing ? typingAt : current, typing }); } catch { /* the stream says when it is back */ }
  }
  document.addEventListener("input", (e) => {
    if (!together || !e.target.closest) return;
    const q = e.target.closest(".q[data-id], tr[data-id]");
    if (!q || !(e.target.tagName === "TEXTAREA" || e.target.type === "text")) return;
    typingAt = q.dataset.id;
    typingUntil = Date.now() + 3000;
    sayWhere();
  });

  // --- the ready check, and who sent it ---------------------------------------------------------
  const readyBtn = h("button", { class: "btn ready-btn", type: "button", onclick: async () => {
    const res = await post("done", { done: !doneBy[me.name] });
    if (!res.ok) toast(`Not marked: ${await errorOf(res)}`);
  } });
  const readyLine = h("span", { class: "ready-line muted small" });
  const sentLine = h("div", { class: "notice sent-by", role: "status", hidden: true });
  function drawReady() {
    readyBtn.textContent = doneBy[me.name] ? "My part is done ✓" : "Mark my part done";
    readyBtn.setAttribute("aria-pressed", String(Boolean(doneBy[me.name])));
    // Who is asked: everyone a question is for, anyone on the page now, and anyone who said they are done.
    const asked = new Set([...Object.values(assign).map((a) => a.name), ...people.map((p) => p.name), ...Object.keys(doneBy)]);
    const done = [...asked].filter((n) => doneBy[n]).sort();
    const togo = [...asked].filter((n) => !doneBy[n]).sort();
    readyLine.textContent = [done.length ? `Done: ${done.join(", ")}` : "", togo.length ? `Still to go: ${togo.join(", ")}` : ""].filter(Boolean).join(" · ");
    sentLine.hidden = !sentNote;
    if (sentNote) sentLine.textContent = `Sent to the agent by ${sentNote.by === me.name ? "you" : sentNote.by} · ${clock(new Date(sentNote.at))}. Changes since are saved for everyone; send again for the agent to have them.`;
  }

  // --- what happened ---------------------------------------------------------------------------
  const WORDS = { answer: "answered", thread: "said something on", assign: "assigned", done: "marked their part done", "not done": "took back done", sent: "sent it to the agent" };
  const activityDialog = h("dialog", { class: "history activity", "aria-label": "What happened" });
  /** Note what happened here as the server does: one person's changes to one question within a minute are one line. */
  function noted(entry) {
    const last = activity.at(-1);
    if (last && last.who === entry.who && last.what === entry.what && last.question === entry.question && Date.parse(entry.at) - Date.parse(last.at) < 60_000) activity = [...activity.slice(0, -1), { ...last, at: entry.at }];
    else activity = [...activity, entry].slice(-200);
  }
  function showActivity() {
    activityDialog.replaceChildren(
      h("div", { class: "history-head" }, h("h2", { class: "grow" }, "What happened"), h("button", { class: "btn", type: "button", onclick: () => activityDialog.close() }, "Close")),
      activity.length ? h("ol", { class: "rounds" }, [...activity].reverse().map((a) => h("li", null, h("span", { class: "muted small", title: a.at }, `${clock(new Date(a.at))} `), h("b", null, a.who), ` ${WORDS[a.what] ?? a.what}`, a.question ? ` ${qName(a.question)}` : "", a.to ? ` to ${a.to}` : ""))) : h("p", { class: "muted" }, "Nothing yet."));
    activityDialog.showModal();
  }

  // --- the event stream ----------------------------------------------------------------------------
  function collabStart() {
    if (!together) return;
    footer.querySelector(".row").insertBefore(h("span", { class: "ready" }, readyBtn, readyLine), statusEl.nextSibling);
    questionsView.prepend(sentLine);
    app.append(activityDialog);
    qs.forEach((q) => uis.get(q.id)?.drawCollab?.(true));
    drawReady();
    // EventSource opens again by itself after a drop, with the same connection; the first event says the page's state each time.
    const events = new EventSource(`/__ask/${encodeURIComponent(key)}/events/${encodeURIComponent(spec.id)}?conn=${conn}`);
    const on = (type, fn) => events.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch { /* one bad event never stops the page */ } });
    on("hello", (d) => {
      threads = d.collab.threads; assign = d.collab.assign; doneBy = d.collab.done; sentNote = d.collab.sent; activity = d.collab.activity;
      const before = people;
      people = d.people;
      const changes = Object.fromEntries(qs.map((q) => [q.id, d.working.answers[q.id] ?? null]).filter(([id, v]) => sig(v) !== known.get(id) || sig(v) !== sig(A[id])));
      by = { ...d.working.by };
      at = { ...d.working.at };
      apply(changes, by, at, "Someone");
      qs.forEach((q) => uis.get(q.id)?.drawCollab?.(true));
      drawPeople(before); drawReady();
      sayWhere(true);
    });
    on("working", (d) => {
      apply(d.changes, d.by, d.at, d.who);
      for (const id of Object.keys(d.changes)) uis.get(id)?.drawCollab?.();
      noted({ at: new Date().toISOString(), who: d.who, what: "answer", question: d.changed });
    });
    on("presence", (d) => { const before = people; people = d.people; drawPeople(before); drawReady(); });
    on("thread", (d) => {
      threads = { ...threads, [d.question]: [...(threads[d.question] ?? []), d.entry] };
      noted({ at: d.entry.at, who: d.entry.by, what: "thread", question: d.question });
      uis.get(d.question)?.drawTalk?.();
      if (d.entry.by !== me.name && names(d.entry.text).has(me.name)) { toast(`${d.entry.by} named you on ${qName(d.question)}.`); notifier.tell(`${spec.title}: ${d.entry.by} named you`, d.entry.text, `${here}#${encodeURIComponent(d.question)}`); }
    });
    on("assign", (d) => { assign = d.assign; qs.forEach((q) => uis.get(q.id)?.drawAssign?.()); drawReady(); });
    on("done", (d) => { doneBy = d.done; drawReady(); });
    on("sent", (d) => {
      sentNote = d.sent;
      drawReady();
      // Whoever asked it is told when someone else sends it.
      if (data.origin?.by === me.name && d.sent.by !== me.name) {
        toast(`${d.sent.by} sent your ask to the agent.`);
        notifier.tell(`${spec.title}: sent by ${d.sent.by}`, "Your agent has the answers.", `${here}|sent|${d.sent.at}`);
        notifier.seen(`${here}|sent|${d.sent.at}`);
      }
    });
    on("answered", (d) => { if (d.to === me.name) toast(`${d.by} answered ${qName(d.question)}, which you assigned.`); });
    on("replaced", () => { events.close(); toast("This page was built again with other questions; reload it."); });
    setInterval(() => { if (!document.hidden) sayWhere(); }, 1000);
    setInterval(() => { if (!document.hidden) sayWhere(true); }, 15_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) sayWhere(true); });
  }
