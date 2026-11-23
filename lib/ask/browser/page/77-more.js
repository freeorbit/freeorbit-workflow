// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts are listed at pageScript
// in lib/ask/page.mjs.
  // --- asking the agent for more ------------------------------------------------------
  // The person asks for more on a question, or the page, or proposes an
  // option; the server keeps the ask (POST /__ask/<key>/more/<id>), the
  // agent's wait wakes on it, and the agent's reply comes back through the
  // poll (lib/ask/more.mjs) and is drawn in place. Details written when the
  // page was built fold under the question, and need no ask.

  const { PAGE } = S;
  const moreOn = !off.has("more");
  const canAsk = moreOn && served;
  let more = { asks: data.more?.asks ?? {}, replies: data.more?.replies ?? {}, told: data.more?.told ?? {} };
  const moreUis = new Map();

  /** What a person may ask for, by the kind of page: a review's findings, pictures, or a choice. */
  function chipsFor(q) {
    if (!q) return ["What is this page for?", "What happens after I send?", "Where should I start?"];
    if (spec.template === "triage") return ["Show the code", "Why it matters", "Show the fix", "An example"];
    if (q.pictures.length || q.compare) return ["What should I look at?", "What changed here?", "Why does it matter?"];
    if (q.type === "one" || q.type === "many") return ["Explain more", "Show an example", "What would you pick, and why?", "What does each option change?"];
    return ["Explain more", "Show an example", "Why is this asked?"];
  }
  const waitingAsks = (where) => S.waitingAsks(more.asks[where], more.replies[where]);
  /** What an ask waits on: the agent has it (wait told it), one waits and will, or none waits on the page now. */
  const waitWords = (where, a) => (a.n <= (Number(more.told[where]) || 0) ? "The agent has it, and is writing its answer…" : waitedOn ? "Waiting for the agent…" : "Waiting for the agent: none waits on this page now, so it sees this when it next waits.");
  const anyWaiting = () => Object.keys(more.asks).some((where) => waitingAsks(where).length);

  /**
   * The more of one question, or of the page: its details written at build,
   * the thread of asks and replies, and the box to ask in. Gives the parts
   * to place, and `open` to show the box.
   */
  function moreParts(where, q) {
    const pre = (q ? q.more : spec.more) ?? [];
    const details = pre.length ? (q ? h("details", { class: "more-pre" }, h("summary", null, "Details"), h("div", { class: "more-body" }, pre.map((b) => drawBlock(b)))) : h("div", { class: "more-pre open" }, pre.map((b) => drawBlock(b)))) : null;
    const thread = h("ol", { class: "more-thread", "aria-label": q ? `Asked for more about ${q.text}` : "Asked for more about the page", hidden: true });
    if (!canAsk) return { details, thread, box: null, open: () => {}, draw: () => drawThread(where, thread) };
    let kind = "more";
    const options = q && (q.type === "one" || q.type === "many");
    const area = h("textarea", { rows: "2", maxlength: "1000", placeholder: "What would help? The agent answers here, while you go on.", "aria-label": q ? `Ask the agent for more about ${q.text}` : "Ask the agent about this page",
      onkeydown: (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); ask(); } } });
    const chips = h("div", { class: "more-chips" }, chipsFor(q).map((t) => h("button", { type: "button", class: "chip-btn", onclick: () => { area.value = t; area.focus(); } }, t)));
    const setKind = (k) => {
      kind = k;
      seg?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
      chips.hidden = k === "option";
      area.placeholder = k === "option" ? "Your option, and why it fits better. The agent can add it to pick." : "What would help? The agent answers here, while you go on.";
      area.focus();
    };
    const seg = options ? h("div", { class: "seg more-kind" }, [["more", "Ask for more"], ["option", "Propose an option"]].map(([k, label]) => h("button", { type: "button", "data-kind": k, "aria-pressed": String(k === kind), onclick: () => setKind(k) }, label))) : null;
    const askBtn = h("button", { class: "btn primary", type: "button", onclick: () => ask() }, "Ask", h("kbd", null, "Ctrl ↵"));
    const box = h("div", { class: "more-box", hidden: true }, seg, chips, h("div", { class: "note" }, area),
      h("div", { class: "acts" }, h("span", { class: "grow muted small" }, "Your answers stay as they are."), h("button", { class: "btn", type: "button", onclick: () => { box.hidden = true; } }, "Cancel"), askBtn));
    async function ask() {
      const text = area.value.trim();
      if (!text) { toast("Say what would help, or pick one of the suggestions."); area.focus(); return; }
      askBtn.disabled = true;
      try {
        const res = await fetch(`/__ask/${encodeURIComponent(key)}/more/${encodeURIComponent(spec.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify({ question: where, kind, text }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { toast(`Not asked: ${body.error ?? res.status}`); return; }
        more.asks[where] = [...(more.asks[where] ?? []), { n: body.n, kind, text, at: new Date().toISOString() }];
        area.value = "";
        box.hidden = true;
        drawThread(where, thread);
        toast(waitedOn ? "Asked. The agent answers here; go on meanwhile." : "Asked. No agent is waiting on this page now; it sees this when it next waits.");
        pollSoon();
      } catch {
        toast("Can't reach the server; nothing was asked.");
      } finally {
        askBtn.disabled = false;
      }
    }
    return { details, thread, box, open: () => { box.hidden = false; area.focus(); }, draw: () => drawThread(where, thread) };
  }

  /**
   * The asks and the agent's replies, oldest first, each reply with what it
   * shows and the options it added. Drawn again only when they, or whether
   * an agent waits, changed: a question is synced on every key typed in it.
   */
  const drawn = new WeakMap();
  function drawThread(where, thread) {
    const asks = (more.asks[where] ?? []).map((a) => ({ ...a, mine: true }));
    const replies = more.replies[where] ?? [];
    const said = `${asks.length}:${asks.at(-1)?.n ?? 0}:${replies.length}:${replies.at(-1)?.at ?? ""}:${Boolean(waitedOn)}:${more.told[where] ?? 0}`;
    if (drawn.get(thread) === said) return;
    drawn.set(thread, said);
    const all = [...asks, ...replies].sort((x, y) => String(x.at).localeCompare(String(y.at)));
    thread.hidden = !all.length;
    const waiting = new Set(waitingAsks(where).map((a) => a.n));
    thread.replaceChildren(...all.map((item) => item.mine
      ? h("li", { class: "ask" }, h("div", { class: "more-who" }, h("span", { class: "who you" }, item.kind === "option" ? "You proposed" : "You asked"), h("span", { class: "muted small", title: item.at }, ago(item.at))), h("div", { class: "more-text" }, item.text),
        waiting.has(item.n) ? h("div", { class: "more-state muted small", role: "status" }, waitWords(where, item)) : null)
      : h("li", { class: "more-reply" }, h("div", { class: "more-who" }, h("span", { class: "who" }, "Agent"), h("span", { class: "muted small", title: item.at }, ago(item.at))),
        (item.blocks ?? []).map((b) => drawBlock(b)),
        (item.options ?? []).length ? h("p", { class: "muted small more-added" }, `Added ${item.options.length === 1 ? "an option" : "options"} to pick: ${item.options.map((o) => o.label).join(", ")}.`) : null)));
  }

  /** A question's more: the Ask for more button in its quiet row, the details, the thread, and the box. */
  function moreFor(q, ui, body) {
    const parts = moreParts(q.id, q);
    moreUis.set(q.id, parts);
    if (canAsk) body.querySelector(".meta")?.append(h("button", { class: "ghost more-btn", type: "button", title: "Ask the agent to explain, show an example or the code, or propose an option", onclick: () => parts.open() }, "Ask for more", h("kbd", { class: "hint" }, "A")));
    body.append(...[parts.details, parts.thread, parts.box].filter(Boolean));
    ui.drawMore = parts.draw;
    ui.focusMore = parts.open;
  }

  // --- the page's own more: Explain this page --------------------------------------------
  // Built with the page (90), once the blocks part has its drawings.
  let pageParts = null;
  let pageMore = null;
  function pageMoreBuild() {
    // Details written at build show even where asking is off; only asking turns off.
    if (!(canAsk || spec.more?.length) || !qs.length) return null;
    pageParts = moreParts(PAGE, null);
    pageMore = h("section", { class: "page-more", hidden: true, "aria-label": "About this page" }, h("div", { class: "page-more-head" }, h("h2", { class: "grow" }, "About this page"), h("button", { class: "btn", type: "button", onclick: () => { pageMore.hidden = true; } }, "Close")), ...[pageParts.details, pageParts.thread, pageParts.box].filter(Boolean));
    moreUis.set(PAGE, pageParts);
    header.querySelector(".row").insertBefore(h("button", { class: "btn page-more-btn", type: "button", title: "What the page is about, and asking the agent about it", onclick: () => { pageMore.hidden = false; pageParts.draw(); pageParts.open(); pageMore.scrollIntoView({ block: "start", behavior: "smooth" }); } }, "Explain this page"), menuBtn);
    return pageMore;
  }

  // --- the agent's replies coming in -------------------------------------------------------
  /** Lay the replies the poll brought over the page: new options to pick, threads, and word of a new reply. */
  let moreSaid = "";
  function applyMore(next) {
    // Drawn again only when the asks or the replies changed, so a poll costs the page nothing.
    const said = JSON.stringify(next);
    if (said === moreSaid) return;
    moreSaid = said;
    const count = (m) => Object.values(m.replies ?? {}).reduce((n, r) => n + r.length, 0);
    const before = count(more);
    const had = Object.fromEntries(Object.entries(more.replies).map(([where, r]) => [where, r.length]));
    more = { asks: next.asks ?? {}, replies: next.replies ?? {}, told: next.told ?? {} };
    for (const q of qs) {
      for (const o of (more.replies[q.id] ?? []).flatMap((r) => r.options ?? [])) {
        if (q.options.some((x) => x.id === o.id) || (q.type !== "one" && q.type !== "many")) continue;
        const added = S.addedOption(o);
        q.options.push(added);
        uis.get(q.id)?.addOption?.(added);
      }
    }
    for (const [where, parts] of moreUis) {
      parts.draw();
      // A question opens to show a reply that is new since the last poll; the person's folding stays otherwise.
      const ui = uis.get(where);
      if (ui && moreSeen != null && (more.replies[where]?.length ?? 0) > (had[where] ?? 0) && !ui.unfold) { ui.unfold = true; ui.sync(); }
    }
    const now = count(more);
    if (moreSeen != null && now > moreSeen && now > before) {
      notifier.tell(`${spec.title}: the agent answered`, "More is under the question you asked about.", `${here}#more-${now}`);
      toast("The agent answered under your ask.");
      // A reply after a send asks again, as a reply under a question does.
      if (sent) sendState("changed");
      if (pageParts && more.replies[PAGE]?.length && pageMore.hidden && waitingAsks(PAGE).length === 0) pageMore.hidden = false;
    }
    moreSeen = now;
    qs.forEach((q) => uis.get(q.id)?.sync());
    refresh();
  }
  // Served, the page learns its replies from its first poll; only ones after that are news.
  let moreSeen = served ? null : Object.values(more.replies).reduce((n, r) => n + r.length, 0);
  // While an ask waits, the page reads the server more often, so the reply shows soon after the agent writes it.
  let soonTimer = null;
  function pollSoon() {
    clearTimeout(soonTimer);
    // Only while the page is in view and an agent waits on it; else the page's own poll, slower out of view, is enough.
    soonTimer = setTimeout(async () => { if (document.hidden || !waitedOn) return; await pollLive(); if (anyWaiting()) pollSoon(); }, 1500);
  }
