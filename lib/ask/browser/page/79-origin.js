// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts are listed at pageScript
// in lib/ask/page.mjs.
  // --- where the ask came from ---------------------------------------------------------
  // Who asked it, on a team server, as the server stamped it from their token
  // (data.origin.by), and the work it came from, as their kit said: the
  // repository, the branch, the commit, and the branch's pull request with its
  // state, which says when the work has merged. A click on who asked shows
  // their other open asks, and on a team page, a way to message them. Other
  // open asks from the same branch are said, so a batch is answered at once.

  const origin = served ? data.origin ?? null : null;
  const repo = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+){1,6}$/.test(spec.asker?.repo ?? "") ? spec.asker.repo : "";
  const urlPath = (s) => String(s).split("/").map(encodeURIComponent).join("/");
  const PR_WORDS = { open: "open", draft: "draft", merged: "merged", closed: "closed" };
  /** "Your" or "ana's", for the person an agent or an ask is of. */
  const whose = (name) => (me && name === me.name ? "Your" : `${name}'s`);

  /** The asker's card: who they are, their other open asks, and a line to them under the current question. */
  function askerCard(anchor) {
    const name = origin.by;
    const role = origin.role ?? (together?.people ?? []).find((p) => p.name === name)?.role ?? "";
    const theirs = inbox.filter((i) => i.askedBy === name && i.href !== here && i.state !== "answered" && i.state !== "status");
    popAt(anchor,
      h("div", { class: "h" }, `${me && name === me.name ? "You" : name}${role ? ` · ${role}` : ""}`),
      h("div", { class: "card-line muted small" }, `Asked this page${spec.asker?.branch ? ` from ${spec.asker.branch}` : ""}.`),
      ...(theirs.length ? [h("div", { class: "h" }, `${whose(name)} other open asks`), ...theirs.slice(0, 8).map((i) => h("a", { class: "item", href: i.href }, h("span", { class: `state ${i.state}` }, i.state === "partial" ? "Partly" : "Waiting"), h("span", { class: "t" }, i.title), h("span", { class: "s" }, ago(i.asked))))] : []),
      together && !(me && name === me.name) && uis.get(current) ? h("button", { class: "item", type: "button", onclick: () => { closePop(); uis.get(current)?.openTalk?.(`@${name} `); } }, h("span", { class: "t" }, `Message ${name}`), h("span", { class: "s" }, "under this question")) : null);
  }

  /** The header's line: who asked it, and the work it came from, each linked where the repository is known. */
  function drawOrigin() {
    const whoEl = header.querySelector(".who") ?? header.querySelector(".titles").appendChild(h("div", { class: "who" }));
    const parts = [];
    parts.push(["Asked by ", h("button", { class: "asker-btn", type: "button", title: "Who asked it, and their other asks", style: { "--c": tone(origin.by) }, onclick: (e) => askerCard(e.currentTarget) }, me && origin.by === me.name ? "you" : origin.by)]);
    const a = spec.asker ?? {};
    if (a.project) parts.push(a.project);
    const branch = a.worktree || a.branch;
    if (branch) parts.push(repo && a.branch ? h("a", { href: `${repo}/tree/${urlPath(a.branch)}`, target: "_blank", rel: "noopener noreferrer", title: `The branch ${a.branch}` }, branch) : branch);
    if (origin?.pr && repo) parts.push(h("a", { class: `pr-chip ${origin.prState}`, href: `${repo}/pull/${encodeURIComponent(origin.pr)}`, target: "_blank", rel: "noopener noreferrer", title: origin.checked ? `As their kit saw it ${ago(origin.checked)}` : "" }, `PR #${origin.pr} ${PR_WORDS[origin.prState] ?? ""}`.trim()));
    if (a.commit) parts.push(repo ? h("a", { class: "num", href: `${repo}/commit/${encodeURIComponent(a.commit)}`, target: "_blank", rel: "noopener noreferrer", title: "The commit it was asked at" }, a.commit) : h("span", { class: "num" }, a.commit));
    const line = parts.flatMap((p, i) => (i ? [" · ", p] : [p])).flat();
    const all = [...line, ...(served ? [line.length ? " · " : "", h("a", { href: "/" }, "All asks")] : [])];
    whoEl.replaceChildren(...all);
    // The line is cut to the header's width; all of it shows on hover.
    whoEl.title = whoEl.textContent;
  }

  // The work it came from has merged or closed: the page says so, as the asker's kit last saw it.
  const staleNote = h("div", { class: "notice warn stale", role: "status", hidden: true });
  // Other open asks from the same branch, to answer as one batch.
  const branchNote = h("div", { class: "notice branch-asks", role: "status", hidden: true });
  function drawStale() {
    const done = origin?.pr && (origin.prState === "merged" || origin.prState === "closed");
    staleNote.hidden = !done;
    if (done) staleNote.replaceChildren(h("span", { class: "grow" }, `The work this came from is ${origin.prState}: PR #${origin.pr}${origin.checked ? `, as ${whose(origin.by).replace(/^Your$/, "your")} kit saw it ${ago(origin.checked)}` : ""}. Its answers may no longer be needed.`));
  }
  /** After each read of the inbox: other open asks from this branch. */
  function originRefresh(items) {
    const branch = spec.asker?.branch;
    const same = branch ? items.filter((i) => i.href !== here && i.key === key && i.asker?.branch === branch && i.state !== "answered" && i.state !== "status") : [];
    branchNote.hidden = !same.length;
    if (same.length) branchNote.replaceChildren(h("span", { class: "grow" }, `${same.length === 1 ? "1 more open ask" : `${same.length} more open asks`} from ${branch}: `, same.slice(0, 5).flatMap((i, n) => [n ? ", " : "", h("a", { href: i.href }, i.title)])));
  }
  // Only on a team server, where the person who asked is not the one reading; a page on this machine keeps its own line.
  function originStart() {
    if (!origin) return;
    drawOrigin();
    drawStale();
    questionsView.prepend(staleNote, branchNote);
  }
