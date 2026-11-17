// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts, by file name: 10 the frame (helpers,
// the look, the answers and undo, header, popovers, outline, settings), 20
// pictures, 30 a question, 35 the richer answers, 40 bulk answers, 45 a launch page's command, 50
// moving around, 60 sending, 70 other asks with the command palette and
// keys, 80 blocks, 85 charts and diagrams, and 90 building the page.
  // --- a launch page's command ---------------------------------------------------------
  // A launch page's answer is a command: the run picked, with its options' flags. It sits
  // above Send and is made again on every change, so what is sent is what was shown.
  const launchBox = spec.launch ? h("div", { class: "launchcmd", role: "status", "aria-live": "polite" }) : null;
  if (launchBox) {
    footer.prepend(launchBox);
    document.documentElement.dataset.launch = "";
  }
  // A run's details, when the spec gives them, sit beside the runs: the run in view
  // (pointed at or focused), else the one picked, else the recommended one.
  const details = spec.launch?.details ?? null;
  let detailsPanel = null;
  let inView = null;
  function detailsShow() {
    if (!detailsPanel) return;
    const run = qs.find((q) => q.id === "run");
    const id = inView ?? A.run?.choice ?? run?.recommended ?? null;
    if (detailsPanel.dataset.run === String(id)) return;
    detailsPanel.dataset.run = String(id);
    const label = run?.options.find((o) => o.id === id)?.label ?? "";
    const blocks = id ? details[id] ?? [] : [];
    detailsPanel.replaceChildren(
      h("div", { class: "details-head" }, h("span", { class: "muted small" }, inView && inView !== A.run?.choice ? "Looking at" : A.run?.choice ? "Picked" : "Recommended"), h("b", null, label)),
      ...(blocks.length ? blocks.map((b) => drawBlock(b)) : [h("p", { class: "muted small" }, "No more about this run.")]));
  }
  function detailsMount() {
    if (!details || detailsPanel) return;
    const body = document.querySelector('#q-run .q-body');
    const opts = body?.querySelector(".opts");
    if (!body || !opts) return;
    body.classList.add("has-details");
    detailsPanel = h("aside", { class: "launch-details", "aria-live": "polite", "aria-label": "About this run" });
    body.append(detailsPanel);
    const look = (e) => {
      const card = e.target.closest?.(".opt");
      inView = card?.dataset.id ?? null;
      detailsShow();
    };
    opts.addEventListener("mouseover", look);
    opts.addEventListener("focusin", look);
    opts.addEventListener("mouseleave", () => { inView = null; detailsShow(); });
  }
  function launchRefresh() {
    detailsMount();
    detailsShow();
    if (!launchBox) return;
    const command = S.launchCommand(spec.launch, qs, A);
    launchBox.replaceChildren(...[
      h("span", { class: "lbl" }, command ? "Runs" : "Pick a run"),
      command ? h("code", { title: command }, command) : h("span", { class: "muted small grow" }, "The command shows here once a run is picked."),
      command ? h("button", { class: "btn", type: "button", onclick: async () => toast((await copyText(command)) ? "Copied the command." : "Could not copy.") }, "Copy") : null,
    ].filter(Boolean));
  }
