// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 75 a live page, replies, history, changes, steps, and saying a page
// waits, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- what the page says between builds ----------------------------------------
  // A live page's status, the agent's replies under questions, earlier
  // rounds of answers, what changed since the last ask, steps, and saying a
  // page is waiting. The server keeps each (lib/ask/live.mjs); the page polls
  // /__ask/<key>/live/<id>, or reads them from its data when offline.

  const { notifier } = window.wfAskShared;
  if (served) {
    notifier.configure({ key, id: spec.id, token });
    notifier.init();
  }
  let status = data.live ?? null;
  let replies = data.replies ?? {};
  const repliesOn = !off.has("replies");

  // --- a live page --------------------------------------------------------------------
  const STATE_WORDS = { running: ["Running", "●"], waiting: ["Waiting on you", "◐"], done: ["Done", "✓"], failed: ["Failed", "✕"] };
  const liveCard = spec.live ? h("section", { class: "live-card", "aria-live": "polite", "aria-label": "Where it stands" }) : null;
  let liveAt = "";
  function liveMarkdown() {
    if (!status) return "";
    const [word] = STATE_WORDS[status.state] ?? [status.state];
    return [`# ${spec.title}: ${word}`, "", status.step ? `${status.step}${status.progress ? ` (${status.progress[0]} of ${status.progress[1]})` : ""}` : "", "", ...(status.log?.length ? ["```", ...status.log, "```"] : [])].join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
  // The card is built once and changed in place, so the bar eases, numbers count, and new log lines come in.
  let liveParts = null;
  function liveSkeleton() {
    const chip = h("span", { class: "live-state" });
    const step = h("span", { class: "live-step grow" });
    const when = h("span", { class: "muted small" });
    const fill = h("i");
    const label = h("span", { class: "num" });
    const bar = h("div", { class: "live-progress", role: "progressbar", "aria-valuemin": "0" }, fill, label);
    const blocks = h("div", { class: "live-blocks" });
    const log = h("div", { class: "live-log", tabindex: "0", role: "log", "aria-label": "Log" });
    const summary = h("summary");
    const logbox = h("details", { class: "live-logbox" }, summary, log);
    const head = h("div", { class: "live-head" }, chip, step, when,
      exportButton([["Copy the status as Markdown", async () => toast((await copyText(liveMarkdown())) ? "Copied the status." : "Could not copy.")], ["Save the log", () => saveFile(`${spec.id}-log.txt`, `${(status?.log ?? []).join("\n")}\n`, "text/plain")]], "the status"));
    liveCard.replaceChildren(head, bar, blocks, logbox);
    return { chip, step, when, bar, fill, label, blocks, log, summary, logbox, state: "", stepText: null, lines: [], keys: [] };
  }
  function drawLive() {
    if (!liveCard) return;
    if (!status) {
      liveCard.replaceChildren(h("div", { class: "live-head" }, h("span", { class: "live-state running" }, h("span", { "aria-hidden": "true" }, "●"), " Starting"), h("span", { class: "grow muted small" }, "The agent has not said where it stands yet.")));
      liveParts = null;
      return;
    }
    if (status.at === liveAt) { if (liveParts) liveParts.when.textContent = `Updated ${ago(status.at)}`; return; }
    liveAt = status.at;
    const p = (liveParts ??= liveSkeleton());
    const [word, mark] = STATE_WORDS[status.state] ?? [status.state, "•"];
    liveCard.dataset.state = status.state;
    if (p.state !== status.state) {
      p.chip.className = `live-state ${status.state}`;
      p.chip.replaceChildren(h("span", { "aria-hidden": "true" }, mark), ` ${word}`);
      if (p.state) M.enter(p.chip, { duration: M.DUR.quick });
      p.state = status.state;
    }
    if (p.stepText !== status.step) {
      p.step.textContent = status.step || "";
      if (p.stepText != null) M.enter(p.step, { duration: M.DUR.quick });
      p.stepText = status.step;
    }
    p.when.textContent = `Updated ${ago(status.at)}`;
    p.when.title = status.at;
    // The bar eases to its new width (its transition), and its count counts.
    p.bar.hidden = !status.progress;
    if (status.progress) {
      const [done, of] = status.progress;
      const before = p.label.textContent;
      p.fill.style.width = `${(done / of) * 100}%`;
      p.label.textContent = `${done} of ${of}`;
      p.bar.setAttribute("aria-valuemax", String(of));
      p.bar.setAttribute("aria-valuenow", String(done));
      p.bar.setAttribute("aria-label", `${done} of ${of}`);
      if (before) M.count(p.label, before, p.label.textContent);
    }
    // Blocks are drawn again; a tile's number counts from what it said, and only a block that is new comes in.
    const said = new Map([...p.blocks.querySelectorAll(".stat")].map((el) => [el.querySelector(".stat-label")?.textContent, el.querySelector(".stat-value")?.textContent]));
    const keyOf = (b) => `${b.type}:${b.title}:${b.id}`;
    const fresh = status.blocks ?? [];
    p.blocks.replaceChildren(...fresh.map((b) => drawBlock(b)));
    p.blocks.hidden = !fresh.length;
    [...p.blocks.children].forEach((el, n) => { if (p.keys.length && !p.keys.includes(keyOf(fresh[n]))) M.enter(el); });
    p.keys = fresh.map(keyOf);
    p.blocks.querySelectorAll(".stat").forEach((el) => {
      const was = said.get(el.querySelector(".stat-label")?.textContent);
      const value = el.querySelector(".stat-value");
      if (was != null && value && was !== value.textContent) M.count(value, was, value.textContent);
    });
    // Lines only added are added; the log starting again is drawn again.
    const lines = status.log ?? [];
    const added = lines.length >= p.lines.length && p.lines.every((l, n) => lines[n] === l);
    const atEnd = p.log.scrollHeight - p.log.scrollTop - p.log.clientHeight < 24;
    if (!added) p.log.replaceChildren();
    for (const line of lines.slice(added ? p.lines.length : 0)) p.log.append(h("div", { class: `ll ${added && p.lines.length ? "new" : ""}` }, line || " "));
    p.lines = [...lines];
    p.logbox.hidden = !lines.length;
    p.summary.textContent = `Log, ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
    if (status.state === "failed") p.logbox.open = true;
    // The log follows its end unless the person scrolled up to read.
    if (atEnd || !added) requestAnimationFrame(() => { p.log.scrollTop = p.log.scrollHeight; });
  }

  // --- the agent's replies under a question -------------------------------------------
  /** The thread under a question: the agent's replies, then the person's reply to them. */
  function replyThread(q, ui, body) {
    if (!repliesOn) return;
    const list = h("ol", { class: "replies", "aria-label": "The agent's replies" });
    ui.replyArea = h("textarea", { rows: "2", placeholder: "Your reply", "aria-label": `Your reply to the agent about ${q.text}`, oninput: (e) => { snapshot(true); entry(q.id).reply = e.target.value; changed(q.id); } });
    const box = h("div", { class: "thread", hidden: true }, list, h("div", { class: "note" }, ui.replyArea));
    body.append(box);
    ui.drawReplies = () => {
      const said = replies[q.id] ?? [];
      box.hidden = !said.length;
      list.replaceChildren(...said.map((r) => h("li", null, h("span", { class: "who" }, "Agent"), h("span", { class: "grow" }, r.text), h("span", { class: "muted small", title: r.at }, ago(r.at)))));
      if (ui.replyArea.value !== (A[q.id]?.reply ?? "")) ui.replyArea.value = A[q.id]?.reply ?? "";
    };
  }
  /** Questions the agent replied under that the person has not replied to. */
  const awaitingReply = () => qs.filter((q) => replies[q.id]?.length && !A[q.id]?.reply && shownQ(q));
  const repliesNotice = h("div", { class: "notice", role: "status", hidden: true });
  function drawRepliesNotice() {
    const waiting = awaitingReply();
    repliesNotice.hidden = !waiting.length;
    repliesNotice.replaceChildren(h("span", { class: "grow" }, `The agent replied under ${waiting.length === 1 ? "a question" : `${waiting.length} questions`}: `, waiting.flatMap((q, i) => [i ? ", " : "", h("a", { href: `#q-${q.id}`, onclick: (e) => { e.preventDefault(); go(q.id, true); uis.get(q.id)?.replyArea?.focus(); } }, `${qs.indexOf(q) + 1}. ${q.text.slice(0, 48)}`)])), h("span", { class: "muted small" }, "Reply, then send again."));
  }

  // --- polling: the status and the replies ---------------------------------------------
  // Served, the page learns its replies from its first poll; only ones after that are news.
  let repliesSeen = served ? null : Object.values(replies).reduce((n, r) => n + r.length, 0);
  async function pollLive() {
    try {
      const res = await fetch(`/__ask/${encodeURIComponent(key)}/live/${encodeURIComponent(spec.id)}`, { cache: "no-store" });
      if (!res.ok) return;
      const got = await res.json();
      const was = status?.state;
      status = got.live ?? status;
      replies = got.replies ?? {};
      drawLive();
      if (status && was && was !== status.state && (status.state === "done" || status.state === "failed" || status.state === "waiting")) notifier.tell(`${spec.title}: ${STATE_WORDS[status.state][0]}`, status.step || "", `${here}#live`);
      const count = Object.values(replies).reduce((n, r) => n + r.length, 0);
      if (count !== repliesSeen) {
        if (repliesSeen != null && count > repliesSeen) { notifier.tell(`${spec.title}: the agent replied`, awaitingReply()[0]?.text ?? "", `${here}#reply-${count}`); toast("The agent replied. Reply under the question, then send again."); }
        repliesSeen = count;
        qs.forEach((q) => uis.get(q.id)?.drawReplies?.());
        if (sent) sendState("changed");
      }
      drawRepliesNotice();
    } catch { /* the server is away; the page keeps working */ }
  }

  // --- earlier rounds of answers -------------------------------------------------------
  const historyDialog = h("dialog", { class: "history", "aria-label": "Earlier answers" });
  async function showHistory() {
    let rounds = [];
    try { rounds = (await (await fetch(`/__ask/${encodeURIComponent(key)}/history/${encodeURIComponent(spec.id)}`, { cache: "no-store" })).json()).rounds ?? []; } catch { /* away */ }
    const all = rounds.map((r, i) => `<!-- round ${rounds.length - i}, sent ${r.at} -->\n${r.markdown}`).join("\n");
    historyDialog.replaceChildren(
      h("div", { class: "history-head" }, h("h2", { class: "grow" }, "Earlier answers"),
        rounds.length ? h("button", { class: "btn", type: "button", onclick: async () => toast((await copyText(all)) ? "Copied every round." : "Could not copy.") }, "Copy all") : null,
        rounds.length ? h("button", { class: "btn", type: "button", onclick: () => saveFile(`${spec.id}-history.md`, all, "text/markdown") }, "Save as Markdown") : null,
        h("button", { class: "btn", type: "button", onclick: () => historyDialog.close() }, "Close")),
      rounds.length ? h("ol", { class: "rounds" }, rounds.map((r, i) => h("li", null,
        h("div", { class: "round-head" }, h("b", null, `Round ${rounds.length - i}`), h("span", { class: "muted small" }, ` · sent ${clock(new Date(r.at))}, ${new Date(r.at).toLocaleDateString()}`), r.same ? null : h("span", { class: "chip" }, "An earlier page")),
        h("pre", { class: "round-md" }, r.markdown)))) : h("p", { class: "muted" }, "Nothing sent yet. Each send keeps a round here, and npx wf ask history lists them."));
    historyDialog.showModal();
  }
  const historyOn = served && !off.has("history");

  // --- what changed since the last ask ------------------------------------------------
  const changes = !off.has("changes") ? spec.changes ?? null : null;
  function changeChip(q) {
    if (!changes) return null;
    if (changes.added.includes(q.id)) return h("span", { class: "chip changed new", title: "New since you were last asked" }, "New");
    const c = changes.changed.find((x) => x.id === q.id);
    return c ? h("span", { class: "chip changed", title: `Changed: ${c.what.join(", ")}` }, "Changed") : null;
  }
  function changesNotice() {
    if (!changes) return null;
    const n = (k, one, many) => (changes[k].length ? `${changes[k].length} ${changes[k].length === 1 ? one : many}` : "");
    const parts = [n("added", "new question", "new questions"), n("changed", "changed", "changed"), n("removed", "removed", "removed")].filter(Boolean);
    if (changes.blocks) parts.push("what the page shows");
    if (changes.pictures) parts.push("new pictures");
    const when = changes.since ? new Date(changes.since) : null;
    const list = h("ul", { class: "change-list", hidden: true },
      changes.added.map((id) => { const q = qs.find((x) => x.id === id); return q ? h("li", null, h("b", null, "New: "), h("a", { href: `#q-${id}`, onclick: (e) => { e.preventDefault(); go(id, true); } }, q.text)) : null; }),
      changes.changed.map((c) => { const q = qs.find((x) => x.id === c.id); return q ? h("li", null, h("b", null, "Changed: "), h("a", { href: `#q-${c.id}`, onclick: (e) => { e.preventDefault(); go(c.id, true); } }, q.text), h("span", { class: "muted" }, ` (${c.what.join(", ")})`)) : null; }),
      changes.removed.map((r) => h("li", null, h("b", null, "Removed: "), r.text)));
    const more = changes.added.length + changes.changed.length + changes.removed.length;
    return h("div", { class: "notice changes", role: "status" },
      h("div", { class: "grow" }, h("div", null, `Changed since you were last asked${when ? `, ${when.toLocaleDateString()} ${clock(when)}` : ""}: ${parts.join(", ") || "small details"}.`), list),
      more ? h("button", { class: "btn", type: "button", "aria-expanded": "false", onclick: (e) => { list.hidden = !list.hidden; e.currentTarget.setAttribute("aria-expanded", String(!list.hidden)); e.currentTarget.textContent = list.hidden ? "What changed" : "Hide"; } }, "What changed") : null);
  }

  // --- step by step --------------------------------------------------------------------
  // A step-by-step page shows one section at a time; moving to a question moves to its step.
  let stepTo = null;
  function stepper(wrap) {
    const steps = [...wrap.children];
    const titles = spec.sections.map((s, i) => s.title || `Step ${i + 1}`);
    const stepOf = (id) => steps.findIndex((el) => el.querySelector(`[data-id="${CSS.escape(id)}"]`));
    let at = 0;
    const bar = h("nav", { class: "stepper", "aria-label": "Steps" });
    const doneIn = (el) => {
      const mine = qs.filter((q) => shownQ(q) && el.querySelector(`[data-id="${CSS.escape(q.id)}"]`));
      return mine.length > 0 && mine.every((q) => !isOpen(q));
    };
    const draw = () => bar.replaceChildren(...steps.map((el, i) => h("button", { type: "button", class: `step ${i === at ? "on" : ""} ${doneIn(el) ? "done" : ""}`, "aria-current": i === at ? "step" : null, onclick: () => show(i, true) }, h("span", { class: "step-n", "aria-hidden": "true" }, doneIn(el) ? "✓" : i + 1), h("span", { class: "step-t" }, titles[i]))));
    function show(i, scroll) {
      const was = at;
      at = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach((el, n) => { el.hidden = n !== at; });
      // The next step comes in from the right, the one before from the left.
      if (was !== at) M.enter(steps[at], { from: at > was ? "right" : "left", duration: M.DUR.slow });
      draw();
      if (scroll) bar.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    steps.forEach((el, i) => el.append(h("div", { class: "step-nav" },
      h("button", { class: "btn", type: "button", disabled: i === 0, onclick: () => show(i - 1, true) }, "← Back"),
      h("span", { class: "grow muted small" }, `Step ${i + 1} of ${steps.length}`),
      i < steps.length - 1 ? h("button", { class: "btn primary", type: "button", onclick: () => show(i + 1, true) }, `Next: ${titles[i + 1]} →`) : h("button", { class: "btn primary", type: "button", onclick: () => trySend() }, "Send"))));
    stepTo = (id) => { const i = stepOf(id); if (i >= 0 && i !== at) show(i, false); };
    stepsRefresh = draw;
    show(0, false);
    return bar;
  }
  let stepsRefresh = () => {};

  // --- saying a page is waiting --------------------------------------------------------
  /** The tab's title says how many asks are waiting, and a new one can be told as a notification. */
  function waitingSignals(items) {
    if (!off.has("tabcount")) {
      const n = items.filter((i) => i.state === "waiting" || i.state === "partial").length;
      document.title = `${n ? `(${n}) ` : ""}${spec.title}`;
    }
    if (!off.has("notify")) notifier.check(items, here);
  }
  function notifyField() {
    if (off.has("notify") || !served || !notifier.supported()) return null;
    const box = h("input", { type: "checkbox", checked: notifier.on(), onchange: async (e) => {
      if (e.target.checked) {
        const p = await notifier.enable();
        e.target.checked = p === "granted";
        toast(p !== "granted" ? "The browser did not allow notifications." : notifier.desktop ? "You will be told on this computer's notifications when an agent asks, or replies." : "You will be told when an agent asks, or replies.");
      } else notifier.disable();
    } });
    return h("label", { class: "field switch", title: "A notification when an ask starts waiting, the agent replies, or a live page finishes" }, "Tell me when an agent asks", box);
  }
