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
  function drawLive() {
    if (!liveCard) return;
    if (!status) {
      liveCard.replaceChildren(h("div", { class: "live-head" }, h("span", { class: "live-state running" }, h("span", { "aria-hidden": "true" }, "●"), " Starting"), h("span", { class: "grow muted small" }, "The agent has not said where it stands yet.")));
      return;
    }
    if (status.at === liveAt) return;
    liveAt = status.at;
    const [word, mark] = STATE_WORDS[status.state] ?? [status.state, "•"];
    const log = h("pre", { class: "live-log", tabindex: "0", "aria-label": "Log" }, (status.log ?? []).join("\n"));
    const [done, of] = status.progress ?? [];
    liveCard.dataset.state = status.state;
    liveCard.replaceChildren(...[
      h("div", { class: "live-head" },
        h("span", { class: `live-state ${status.state}` }, h("span", { "aria-hidden": "true" }, mark), ` ${word}`),
        h("span", { class: "live-step grow" }, status.step || ""),
        h("span", { class: "muted small", title: status.at }, `Updated ${ago(status.at)}`),
        exportButton([["Copy the status as Markdown", async () => toast((await copyText(liveMarkdown())) ? "Copied the status." : "Could not copy.")], ["Save the log", () => saveFile(`${spec.id}-log.txt`, `${(status.log ?? []).join("\n")}\n`, "text/plain")]], "the status")),
      status.progress ? h("div", { class: "live-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(of), "aria-valuenow": String(done), "aria-label": `${done} of ${of}` }, h("i", { style: { width: `${(done / of) * 100}%` } }), h("span", { class: "num" }, `${done} of ${of}`)) : null,
      status.blocks?.length ? h("div", { class: "live-blocks" }, status.blocks.map((b) => drawBlock(b))) : null,
      status.log?.length ? h("details", { class: "live-logbox", open: status.state === "failed" ? true : null }, h("summary", null, `Log, ${status.log.length} ${status.log.length === 1 ? "line" : "lines"}`), log) : null].filter(Boolean));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
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
      at = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach((el, n) => { el.hidden = n !== at; });
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
      if (e.target.checked) { const p = await notifier.enable(); e.target.checked = p === "granted"; if (p !== "granted") toast("The browser did not allow notifications."); else toast("You will be told when an agent asks, or replies."); }
      else notifier.disable();
    } });
    return h("label", { class: "field switch", title: "A notification when an ask starts waiting, the agent replies, or a live page finishes" }, "Tell me when an agent asks", box);
  }
