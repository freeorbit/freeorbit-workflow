// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- sending, and the receipt ------------------------------------------------
  // What is sent: the answers, less form values the page shows as wrong, which stay in the draft to fix.
  const payload = () => {
    const out = structuredClone(A);
    for (const q of qs) {
      const fields = out[q.id]?.fields;
      if (!fields) continue;
      for (const f of q.fields) if (fields[f.id] != null && S.fieldProblem(f, fields[f.id])) delete fields[f.id];
    }
    return { id: spec.id, hash: spec.hash, submitted: new Date().toISOString(), answers: S.prune(out) };
  };
  let panel = null;
  function trySend() {
    if (sent && receiptShown) return;
    const open = qs.filter(isOpen);
    if (!open.length) return send();
    panel?.remove();
    let choice = "agent";
    const radio = (v, label) => h("label", null, h("input", { type: "radio", name: "rest", value: v, checked: v === choice, onchange: () => { choice = v; } }), label);
    panel = h("div", { class: "sendpanel", role: "dialog", "aria-label": "Unanswered questions" },
      h("h3", null, `${open.length} ${open.length === 1 ? "question is" : "questions are"} still open`),
      h("div", { class: "muted desc-sm" }, "Send them as:"),
      h("div", { class: "choices" }, radio("agent", "You decide"), radio("later", "Later"), radio("open", "Leave them open")),
      h("div", { class: "acts" },
        h("button", { class: "btn", type: "button", onclick: () => { panel.remove(); panel = null; go(open[0].id, true); } }, "Go back"),
        h("button", { class: "btn primary", type: "button", onclick: () => {
          panel.remove(); panel = null;
          if (choice !== "open") { snapshot(); for (const q of open) if (q.defer) S.setDecide(entry(q.id), choice); persist(); qs.forEach((q) => uis.get(q.id)?.sync()); refresh(); }
          send();
        } }, "Send", h("kbd", null, "↵"))));
    document.body.append(panel);
    panel.querySelector(".btn.primary").focus();
  }
  let retry = 0;
  let retryTimer = null;
  // The send has its own line, so saving a draft never hides a failed send.
  function sendState(s, text) {
    if (s === "changed") { sendBtn.firstChild.textContent = "Send again"; return; }
    sentEl.hidden = false;
    sentEl.className = `saved ${s === "error" ? "err" : "on"}`;
    sentEl.textContent = text;
  }
  async function send() {
    // One send at a time: a retry still waiting is dropped, whoever sends now.
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!served) { copyAnswers(); return; }
    sendBtn.disabled = true;
    sendState("sending", "Sending…");
    try {
      const res = await fetch(`/__ask/${encodeURIComponent(key)}/answers/${encodeURIComponent(spec.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify(payload()) });
      const body = await res.json().catch(() => ({}));
      sendBtn.disabled = false;
      if (!res.ok) { sendState("error", `Not sent: ${body.error ?? res.status}`); toast(`Not sent: ${body.error ?? res.status}`); return; }
      retry = 0;
      clearTimeout(retryTimer);
      retryTimer = null;
      sent = true;
      sendState("sent", `Sent · ${clock()}`);
      showReceipt(body);
    } catch {
      sendBtn.disabled = false;
      retry++;
      const wait = Math.min(30, 2 ** retry);
      sendState("error", `Can't reach the server; your answers are kept here. Trying again in ${wait} s.`);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(send, wait * 1000);
    }
  }
  let receiptShown = false;
  const questionsView = h("div");
  const receiptView = h("div", { class: "receipt", hidden: true, tabindex: "-1" });
  function showReceipt(result) {
    receiptShown = true;
    const open = result?.open ?? qs.filter(isOpen).map((q) => q.id);
    const next = nextAsk();
    receiptView.replaceChildren(
      h("h2", null, open.length ? "Sent, with some left open" : "Sent to the agent"),
      h("p", { class: "sub" }, `${clock()} · ${live().length - open.length} of ${live().length} answered. This is exactly what the agent received.`),
      h("div", { class: "acts" },
        next ? h("button", { class: "btn primary", type: "button", onclick: () => location.assign(next.href) }, `Next waiting ask: ${next.title}`, h("kbd", null, "↵")) : null,
        h("button", { class: "btn", type: "button", onclick: () => hideReceipt() }, "Change answers"),
        h("button", { class: "btn", type: "button", onclick: () => copyAnswers(true) }, "Copy as Markdown"),
        served ? h("a", { class: "btn", href: "/" }, "All asks") : null),
      h("ol", null, qs.map((q, i) => !shownQ(q) ? null : h("li", null, h("div", { class: "q-t" }, `${i + 1}. ${q.text}`), h("div", { class: `a-t ${isOpen(q) ? "open" : ""}` }, summary(q, A[q.id]), A[q.id]?.note ? ` — Note: ${A[q.id].note}` : "", A[q.id]?.pins?.length ? ` — ${A[q.id].pins.length} comments` : "")))));
    questionsView.hidden = true;
    receiptView.hidden = false;
    footer.hidden = true;
    scrollTo({ top: 0 });
    receiptView.focus();
    local.drop(draftKey);
  }
  function hideReceipt() {
    receiptShown = false;
    receiptView.hidden = true;
    questionsView.hidden = false;
    footer.hidden = false;
    footerRefresh();
  }
  function markdown() {
    return [`# ${spec.title} (${spec.id})`, "", ...qs.filter(shownQ).map((q) => `- **${qs.indexOf(q) + 1}. ${q.text}** ${summary(q, A[q.id])}${A[q.id]?.note ? ` — Note: ${A[q.id].note}` : ""}`)].join("\n");
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const area = h("textarea", { class: "sr" }, text);
      document.body.append(area); area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }
  async function copyAnswers(md = false) {
    const text = md ? markdown() : `Answers to the ask page ${spec.id} (${spec.hash}). Paste this into the chat, or save it and run npx wf ask import <file>.\n\n\`\`\`json\n${JSON.stringify(payload(), null, 2)}\n\`\`\`\n`;
    toast((await copyText(text)) ? (md ? "Copied as Markdown." : "Copied. Paste it into the chat.") : "Could not copy; use Save answers file.");
  }
  function downloadAnswers() {
    const a = h("a", { href: URL.createObjectURL(new Blob([`${JSON.stringify(payload(), null, 2)}\n`], { type: "application/json" })), download: `${spec.id}.answers.json` });
    document.body.append(a); a.click(); a.remove();
    toast(`Saved ${spec.id}.answers.json. Send it back, or run npx wf ask import on it.`);
  }

