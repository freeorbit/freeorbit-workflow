// One part of the ask page's script. lib/ask/page.mjs joins the parts in
// file order inside a single function, so they share its names; a part is
// not a script on its own. The parts are listed at pageScript
// in lib/ask/page.mjs.
  // --- a launch page's command ---------------------------------------------------------
  // A launch page's answer is a command: the run picked, with its options' flags. It sits
  // above Send and is made again on every change, so what is sent is what was shown.
  const launchBox = spec.launch ? h("div", { class: "launchcmd", role: "status", "aria-live": "polite" }) : null;
  if (launchBox) {
    footer.prepend(launchBox);
    document.documentElement.dataset.launch = "";
  }
  // A run's details, when the spec gives them, sit in a pane beside the runs: the run
  // pointed at, else the one picked, else the recommended one (S.detailsRun). The pane
  // has a steady height and scrolls inside, so a run with little to show never moves
  // the page. On a narrow window it sits under the run it shows.
  const details = spec.launch?.details ?? null;
  const narrow = window.matchMedia("(max-width: 1000px)");
  let detailsPanel = null;
  let detailsSay = null;
  let inView = null;
  const detailsDrawn = new Map();
  const DETAILS_STATES = { looking: "Previewing", picked: "Picked", recommended: "Recommended" };
  function detailsShow() {
    if (!detailsPanel) return;
    const run = qs.find((q) => q.id === "run");
    const { id, state, picked } = S.detailsRun(inView, A.run?.choice, run?.recommended);
    const key = `${id}|${state}|${picked}`;
    if (narrow.matches) {
      // Under the run it shows, so it follows the eye down a narrow page.
      const card = id ? document.querySelector(`#q-run .opt[data-id="${CSS.escape(id)}"]`) : null;
      if (card && card.nextSibling !== detailsPanel) card.after(detailsPanel);
    } else if (detailsPanel.parentNode !== detailsPanel._home) detailsPanel._home.append(detailsPanel);
    if (detailsPanel.dataset.key === key) return;
    detailsPanel.dataset.key = key;
    detailsPanel.dataset.state = state;
    const label = run?.options.find((o) => o.id === id)?.label ?? "";
    // Each run's blocks are drawn once and kept, so moving between runs only swaps them in.
    if (!detailsDrawn.has(id)) {
      const blocks = id ? details[id] ?? [] : [];
      detailsDrawn.set(id, blocks.length ? blocks.map((b) => drawBlock(b)) : [h("p", { class: "muted small" }, "No more about this run.")]);
    }
    const pickedLabel = picked ? run?.options.find((o) => o.id === picked)?.label : "";
    detailsPanel.replaceChildren(...[
      h("div", { class: "details-head" },
        h("span", { class: `state-chip ${state}` }, DETAILS_STATES[state]),
        h("h3", { class: "details-title" }, label),
        state === "looking" && pickedLabel ? h("span", { class: "muted small" }, `Your pick: ${pickedLabel}`) : null),
      state === "recommended" && run?.why ? h("p", { class: "details-why" }, run.why) : null,
      ...detailsDrawn.get(id),
    ].filter(Boolean));
    // A short line for a screen reader, in its own live region, not the whole pane.
    detailsSay.textContent = `${DETAILS_STATES[state]}: ${label}.`;
  }
  function detailsMount() {
    if (!details || detailsPanel) return;
    const body = document.querySelector("#q-run .q-body");
    const opts = body?.querySelector(".opts");
    if (!body || !opts) return;
    body.classList.add("has-details");
    detailsPanel = h("aside", { class: "launch-details", id: "launch-details", role: "region", tabindex: "0", "aria-label": "About the run" });
    detailsPanel._home = body;
    detailsSay = h("span", { class: "sr-only", role: "status", "aria-live": "polite" });
    body.append(detailsPanel, detailsSay);
    for (const card of opts.querySelectorAll(".opt")) card.setAttribute("aria-controls", "launch-details");
    // Pointing follows after a short moment, so a quick pass over a run does not swap the
    // pane; leaving the runs for the pane keeps it, so its tables can be read and scrolled.
    let wait = null;
    const settle = (id, ms) => {
      clearTimeout(wait);
      wait = setTimeout(() => { inView = id; detailsShow(); }, ms);
    };
    opts.addEventListener("mouseover", (e) => {
      const id = e.target.closest?.(".opt")?.dataset.id ?? null;
      if (id && id !== inView) settle(id, 40);
    });
    opts.addEventListener("focusin", (e) => settle(e.target.closest?.(".opt")?.dataset.id ?? null, 0));
    body.addEventListener("mouseleave", () => settle(null, 150));
    narrow.addEventListener("change", () => { detailsPanel.dataset.key = ""; detailsShow(); });
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
