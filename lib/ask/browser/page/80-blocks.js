// One part of the ask page's script, joined in file order with the others
// inside a single function (see lib/ask/page.mjs); not a script on its own.
  // --- blocks: the parts a page shows around its questions --------------------
  // Each block arrives checked and made ready (lib/ask/blocks.mjs): text as
  // nodes, a table as columns and rows, a diff as runs. Nothing here builds
  // HTML from a string, so no block can bring markup of its own.

  /**
   * The page's sections, each a card of blocks. `hostFor(block)` gives a
   * questions block's questions. On a step-by-step page every section is a
   * card of its own, since each is a step.
   */
  function drawSections(sections, hostFor) {
    const wrap = h("div", { class: "blocks" });
    for (const section of sections) {
      const onlyQuestions = section.blocks.length === 1 && section.blocks[0].type === "questions" && !section.title && !spec.steps;
      if (onlyQuestions) { wrap.append(hostFor(section.blocks[0])); continue; }
      // A block with no title has no head of its own; what it exports joins the section's menu.
      const loose = section.blocks.filter((b) => b.type !== "questions" && !b.title).flatMap((b) => blockExports(b).map(([label, run]) => [`${blockName(b)}: ${label}`, run]));
      const el = h("section", { class: "block-section", "aria-label": section.title || null },
        section.title || loose.length ? h("div", { class: "block-head section-head" }, h("h2", { class: "block-section-title grow" }, section.title || ""), loose.length ? exportButton(loose, section.title || "this section") : null) : null,
        section.note ? h("p", { class: "muted block-note" }, section.note) : null);
      for (const b of section.blocks) el.append(b.type === "questions" ? hostFor(b) : drawBlock(b));
      wrap.append(el);
    }
    return wrap;
  }

  const blockName = (b) => BLOCKS[b.type]?.name ?? b.type;
  function exportButton(items, what) {
    return h("button", { class: "ghost", type: "button", "aria-haspopup": "true", "aria-label": `Export ${what}`, onclick: (e) => popAt(e.currentTarget, h("div", { class: "h" }, "Export"), items.map(([label, run]) => h("button", { class: "item", type: "button", onclick: () => { closePop(); run(); } }, h("span", { class: "t" }, label)))) }, "Export ▾");
  }

  /** One block: its head (title and export) when it has a title, then what it holds. */
  function drawBlock(b) {
    const exports = blockExports(b);
    const head = b.title ? h("div", { class: "block-head" }, h("h3", { class: "block-title" }, b.title), exports.length ? exportButton(exports, b.title) : null) : null;
    const body = BLOCKS[b.type]?.draw(b) ?? h("p", { class: "muted" }, `A ${b.type} block`);
    return h("div", { class: `block block-${b.type}`, id: b.id ? `block-${b.id}` : null }, head, body, b.note ? h("p", { class: "muted small block-note" }, b.note) : null);
  }

  // --- export -------------------------------------------------------------------
  function saveFile(name, text, type) {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    toast(`Saved ${name}.`);
  }
  const fileName = (b, ext) => `${spec.id}-${(b.id || b.title || b.type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || b.type}.${ext}`;
  const { csvCell } = window.wfAskShared;
  const mdCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  function tableCsv(columns, rows) { return [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n"; }
  function tableMd(columns, rows) { return [`| ${columns.map((c) => mdCell(c.label)).join(" | ")} |`, `| ${columns.map((c) => (c.align === "right" ? "---:" : "---")).join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n") + "\n"; }
  function diffText(b) {
    if (b.by === "word") return b.ops.map((o) => (o.op === "same" ? o.s : o.op === "del" ? `[-${o.s}-]` : `{+${o.s}+}`)).join("") + "\n";
    const out = [`--- ${b.labels[0]}`, `+++ ${b.labels[1]}`];
    for (const o of b.ops) for (const line of o.s.split("\n")) out.push(`${o.op === "same" ? " " : o.op === "del" ? "-" : "+"}${line}`);
    return out.join("\n") + "\n";
  }
  /** What a block offers to export, as [label, run] pairs. */
  const blockExports = (b) => BLOCKS[b.type]?.exports(b) ?? [];
  const copyOf = (text, what) => async () => toast((await copyText(text())) ? `Copied ${what}.` : "Could not copy.");
  const save = (b, ext, text, type) => () => saveFile(fileName(b, ext), text(), type);
  const STATS_COLUMNS = [{ label: "Label" }, { label: "Value" }, { label: "Note" }];
  const BOARD_COLUMNS = [{ label: "Column" }, { label: "Card" }, { label: "Note" }, { label: "Owner" }, { label: "Tags" }];

  /**
   * Each block kind the page draws: its name in an export menu, how it is
   * drawn, and what it exports. The kit checks each kind in lib/ask/blocks.mjs
   * (BLOCK_DATA); a kind is added in both records and its styles.
   */
  const BLOCKS = {
    text: { name: "Text", draw: (b) => textBlock(b), exports: (b) => [["Copy as Markdown", copyOf(() => `${b.source.trim()}\n`, "the text")], ["Save as Markdown", save(b, "md", () => `${b.source.trim()}\n`, "text/markdown")]] },
    stats: { name: "Numbers", draw: (b) => statsBlock(b), exports: (b) => {
      const rows = () => b.items.map((i) => [i.label, i.value, i.note]);
      return [["Copy as Markdown", copyOf(() => tableMd(STATS_COLUMNS, rows()), "the numbers")], ["Save as CSV", save(b, "csv", () => tableCsv(STATS_COLUMNS, rows()), "text/csv")]];
    } },
    table: { name: "Table", draw: (b) => tableBlock(b), exports: (b) => {
      const rows = () => b.view?.() ?? b.rows;
      return [["Save as CSV", save(b, "csv", () => tableCsv(b.columns, rows()), "text/csv")], ["Copy as Markdown", copyOf(() => tableMd(b.columns, rows()), "the table")], ["Save as Markdown", save(b, "md", () => tableMd(b.columns, rows()), "text/markdown")]];
    } },
    diff: { name: "Changes", draw: (b) => diffBlock(b), exports: (b) => [[b.by === "word" ? "Copy the changes" : "Copy as a unified diff", copyOf(() => diffText(b), "the diff")], ["Save the diff", save(b, b.by === "word" ? "txt" : "diff", () => diffText(b), "text/plain")]] },
    chart: { name: "Chart", draw: (b) => chartBlock(b), exports: (b) => {
      const t = () => chartTable(b);
      return [["Save as SVG", () => b.svg && saveFile(fileName(b, "svg"), svgText(b.svg), "image/svg+xml")], ["Save as CSV", save(b, "csv", () => tableCsv(t().columns, t().rows), "text/csv")], ["Copy as Markdown", copyOf(() => tableMd(t().columns, t().rows), "the numbers")]];
    } },
    diagram: { name: "Diagram", draw: (b) => diagramBlock(b), exports: (b) => [["Save as SVG", () => b.svg && saveFile(fileName(b, "svg"), svgText(b.svg), "image/svg+xml")], ["Copy as Mermaid", copyOf(() => mermaid(b), "the diagram as Mermaid")]] },
    timeline: { name: "Timeline", draw: (b) => timelineBlock(b), exports: (b) => [["Copy as Markdown", copyOf(() => timelineMd(b), "the timeline")], ["Save as Markdown", save(b, "md", () => timelineMd(b), "text/markdown")]] },
    board: { name: "Board", draw: (b) => boardBlock(b), exports: (b) => [["Copy as Markdown", copyOf(() => boardMd(b), "the board")], ["Save as CSV", save(b, "csv", () => tableCsv(BOARD_COLUMNS, boardRows(b)), "text/csv")]] },
  };

  // --- text ---------------------------------------------------------------------
  function spanEls(list) {
    return list.map((s) => (s.t === "b" ? h("strong", null, s.s) : s.t === "i" ? h("em", null, s.s) : s.t === "code" ? h("code", null, s.s) : s.s));
  }
  function textBlock(b) {
    return h("div", { class: "prose" }, b.nodes.map((n) => {
      if (n.k === "h") return h(`h${Math.min(6, n.level + 3)}`, null, spanEls(n.spans));
      if (n.k === "p") return h("p", null, spanEls(n.spans));
      if (n.k === "ul" || n.k === "ol") return h(n.k, null, n.items.map((it) => h("li", null, spanEls(it))));
      if (n.k === "pre") return h("pre", null, h("code", null, n.text));
      return null;
    }));
  }

  // --- stats --------------------------------------------------------------------
  function statsBlock(b) {
    return h("div", { class: "stats", role: "list" }, b.items.map((i) => h("div", { class: `stat ${i.tone ? `tone-${i.tone}` : ""}`, role: "listitem" },
      h("div", { class: "stat-label" }, i.label), h("div", { class: "stat-value num" }, i.value), i.trend ? sparkline(i.trend, i.label) : null, i.note ? h("div", { class: "stat-note" }, i.note) : null)));
  }

  // --- table --------------------------------------------------------------------
  function tableBlock(b) {
    if (!b.rows.length) return h("p", { class: "muted block-empty" }, b.empty || "Nothing to show.");
    let sortBy = -1;
    let dir = 1;
    let filter = "";
    const tbody = h("tbody");
    const count = h("span", { class: "muted small num" });
    const numeric = (s) => /^-?[\d.,]+%?$/.test(String(s).trim());
    const view = () => {
      const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
      let rows = b.rows.filter((r) => words.every((w) => r.some((c) => String(c).toLowerCase().includes(w))));
      if (sortBy >= 0) {
        const num = rows.every((r) => numeric(r[sortBy]) || r[sortBy] === "");
        rows = [...rows].sort((x, y) => dir * (num ? parseFloat(String(x[sortBy]).replace(/,/g, "")) - parseFloat(String(y[sortBy]).replace(/,/g, "")) : String(x[sortBy]).localeCompare(String(y[sortBy]), undefined, { numeric: true })));
      }
      return rows;
    };
    b.view = view;
    const heads = b.columns.map((c, i) => h("th", { scope: "col", class: c.align === "right" ? "right" : "", "aria-sort": "none" },
      b.sort ? h("button", { type: "button", class: "sort", onclick: () => { dir = sortBy === i ? -dir : 1; sortBy = i; draw(); } }, c.label, h("span", { class: "arrow", "aria-hidden": "true" })) : c.label));
    function draw() {
      const rows = view();
      tbody.replaceChildren(...rows.map((r) => h("tr", null, r.map((cell, i) => h("td", { class: b.columns[i].align === "right" ? "right num" : "" }, cell)))));
      heads.forEach((th, i) => { th.setAttribute("aria-sort", i === sortBy ? (dir > 0 ? "ascending" : "descending") : "none"); });
      count.textContent = rows.length === b.rows.length ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}` : `${rows.length} of ${b.rows.length} rows`;
      if (!rows.length) tbody.append(h("tr", null, h("td", { colspan: b.columns.length, class: "muted" }, "No row has those words.")));
    }
    draw();
    const tools = b.filter ? h("div", { class: "table-tools" }, h("input", { type: "text", class: "filter", placeholder: "Filter rows", "aria-label": `Filter ${b.title || "the table"}`, oninput: (e) => { filter = e.target.value; draw(); } }), count) : h("div", { class: "table-tools" }, count);
    return h("div", null, tools, h("div", { class: "table-wrap" }, h("table", { class: "rows data" }, h("thead", null, h("tr", null, heads)), tbody)));
  }

  // --- diff ---------------------------------------------------------------------
  function diffBlock(b) {
    let mode = b.view;
    const holder = h("div");
    const piece = (o) => h(o.op === "del" ? "del" : o.op === "add" ? "ins" : "span", { class: `d-${o.op}` }, o.s);
    const lines = (o) => o.s.split("\n").map((line) => h("div", { class: `d-line d-${o.op}` }, h("span", { class: "d-mark", "aria-hidden": "true" }, o.op === "del" ? "−" : o.op === "add" ? "+" : " "), line || " "));
    function draw() {
      if (mode === "inline") holder.replaceChildren(h("div", { class: `diff inline by-${b.by}` }, b.by === "word" ? b.ops.map(piece) : b.ops.flatMap(lines)));
      else {
        const side = (keep) => h("div", { class: "diff-side" }, h("div", { class: "diff-label" }, keep === "del" ? b.labels[0] : b.labels[1]),
          h("div", { class: `diff by-${b.by}` }, b.by === "word" ? b.ops.filter((o) => o.op === "same" || o.op === keep).map(piece) : b.ops.filter((o) => o.op === "same" || o.op === keep).flatMap(lines)));
        holder.replaceChildren(h("div", { class: "diff-pair" }, side("del"), side("add")));
      }
    }
    draw();
    const seg = h("div", { class: "seg", role: "group", "aria-label": "How to show the changes" }, [["side", "Side by side"], ["inline", "Inline"]].map(([id, label]) => h("button", { type: "button", "aria-pressed": String(mode === id), onclick: (e) => { mode = id; e.currentTarget.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget))); draw(); } }, label)));
    const added = b.ops.filter((o) => o.op === "add").length;
    const removed = b.ops.filter((o) => o.op === "del").length;
    return h("div", null, h("div", { class: "table-tools" }, seg, h("span", { class: "muted small" }, `${removed} removed, ${added} added`)), holder);
  }

