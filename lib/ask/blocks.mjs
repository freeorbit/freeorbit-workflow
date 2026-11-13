// An ask page's blocks: the parts a page shows around its questions, checked
// and made ready here so the page only draws data. The design is in
// docs/design/ask-blocks.md.
//
//   { "sections": [{ "title": "Where it stands", "blocks": [
//       { "type": "stats", "items": [{ "label": "Checks", "value": "12 of 14", "tone": "warn" }] },
//       { "type": "table", "source": "open-questions" },
//       { "type": "questions" } ] }],
//     "off": ["bulk"] }
//
// A spec may give `blocks` (one section) or `sections`. Text is a small
// Markdown subset, parsed here into nodes; a diff is worked out here; a
// table's rows come inline or from a named source; a part is a project's
// block list, filled from `with`. Nothing a spec says becomes HTML or a path.

/** The block kinds this kit draws. */
export const BLOCK_KINDS = ["text", "stats", "table", "diff", "chart", "diagram", "timeline", "board", "questions", "part"];
/** Page features a page or a project can turn off. */
export const FEATURES = ["bulk", "outline", "palette", "pins", "compare", "regions", "followups", "owners"];
/** The richer question types, which a page or a project can turn off too. */
export const RICH_TYPES = ["scale", "grid", "buckets", "edits", "form"];
export const BLOCK_LIMITS = { blocks: 60, rows: 500, columns: 20, cell: 300, text: 4000, title: 100, note: 300, stat: 24, diff: 2000, trend: 60, series: 8, points: 200, label: 40, nodes: 40, links: 80, events: 100, lanes: 8, cards: 200 };
const CHART_KINDS = ["bar", "line"];
const STATES = ["done", "now", "next", ""];
const TONES = ["ok", "warn", "bad", "info", ""];
const PART = /^[a-z][a-z0-9-]{1,39}$/;

const str = (value) => (value == null ? "" : String(value));
const list = (value) => (Array.isArray(value) ? value : []);

/** Inline spans of a line: **bold**, *italic* or _italic_, and `code`; everything else is text. */
export function spans(line) {
  const out = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g;
  let at = 0;
  for (const m of line.matchAll(pattern)) {
    if (m.index > at) out.push({ t: "text", s: line.slice(at, m.index) });
    if (m[2] != null) out.push({ t: "b", s: m[2] });
    else if (m[3] != null) out.push({ t: "code", s: m[3] });
    else out.push({ t: "i", s: m[4] ?? m[5] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ t: "text", s: line.slice(at) });
  return out;
}

/** The small Markdown a text block takes, as nodes: headings, paragraphs, lists, and code. */
export function parseText(source) {
  const nodes = [];
  const lines = str(source).replace(/\r\n?/g, "\n").split("\n");
  let para = [];
  let items = null;
  const flush = () => {
    if (para.length) nodes.push({ k: "p", spans: spans(para.join(" ")) });
    para = [];
    if (items) nodes.push(items);
    items = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      nodes.push({ k: "pre", text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flush();
      nodes.push({ k: "h", level: heading[1].length, spans: spans(heading[2]) });
    } else if (bullet || numbered) {
      if (para.length) { nodes.push({ k: "p", spans: spans(para.join(" ")) }); para = []; }
      const kind = bullet ? "ul" : "ol";
      if (!items || items.k !== kind) { if (items) nodes.push(items); items = { k: kind, items: [] }; }
      items.items.push(spans((bullet ?? numbered)[1]));
    } else if (!line.trim()) flush();
    else {
      if (items) { nodes.push(items); items = null; }
      para.push(line.trim());
    }
  }
  flush();
  return nodes;
}

/** The changes from `before` to `after`, by line or by word: runs of same, del, and add. */
export function diffOps(before, after, by = "line") {
  const split = (text) => (by === "word" ? str(text).split(/(\s+)/).filter((t) => t !== "") : str(text).replace(/\r\n?/g, "\n").split("\n"));
  const a = split(before);
  const b = split(after);
  // The longest common subsequence, by a table of suffix lengths.
  const n = a.length;
  const m = b.length;
  const len = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const ops = [];
  const push = (op, s) => {
    const last = ops.at(-1);
    if (last && last.op === op) last.s.push(s);
    else ops.push({ op, s: [s] });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return ops.map((each) => ({ op: each.op, s: by === "word" ? each.s.join("") : each.s.join("\n") }));
}

/** Fill `{field}` in every string of a part from `with`. */
function fill(value, values) {
  if (typeof value === "string") return value.replace(/\{(\w+)\}/g, (all, k) => (Object.hasOwn(values, k) ? str(values[k]) : all));
  if (Array.isArray(value)) return value.map((each) => fill(each, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  return value;
}

/** A table's columns and rows, from inline data: rows as objects by key, or as lists in column order. */
function tableData(raw, where, problems) {
  let columns = list(raw.columns).map((c, i) => (typeof c === "string" ? { key: c, label: c, align: "" } : { key: str(c?.key || c?.label || `c${i + 1}`), label: str(c?.label || c?.key || `Column ${i + 1}`), align: c?.align === "right" ? "right" : "" }));
  const rawRows = list(raw.rows);
  if (!columns.length && rawRows.length && rawRows[0] && typeof rawRows[0] === "object" && !Array.isArray(rawRows[0])) columns = Object.keys(rawRows[0]).map((k) => ({ key: k, label: k, align: "" }));
  if (columns.length > BLOCK_LIMITS.columns) problems.push(`${where}: at most ${BLOCK_LIMITS.columns} columns`);
  if (rawRows.length > BLOCK_LIMITS.rows) problems.push(`${where}: at most ${BLOCK_LIMITS.rows} rows; split it, or show fewer`);
  const rows = rawRows.slice(0, BLOCK_LIMITS.rows).map((row) => columns.map((c, i) => {
    const cell = Array.isArray(row) ? row[i] : row?.[c.key];
    const s = str(cell);
    return s.length > BLOCK_LIMITS.cell ? `${s.slice(0, BLOCK_LIMITS.cell - 1)}…` : s;
  }));
  return { columns, rows };
}

/**
 * One block, checked and made ready, or null when it is turned off or wrong.
 * `ctx` holds `off` (a set), `source(name, block)` for a named source's
 * `{ columns, rows, empty }`, and the project's parts by name.
 */
function block(raw, where, problems, ctx) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${where}: a block is an object with a type`);
    return [];
  }
  const type = str(raw.type);
  if (!BLOCK_KINDS.includes(type)) {
    problems.push(`${where}: type is one of ${BLOCK_KINDS.join(", ")}, not ${type || "nothing"}`);
    return [];
  }
  if (type === "part") {
    const name = str(raw.name);
    if (!PART.test(name)) { problems.push(`${where}: a part names a file in .workflow/ask-parts`); return []; }
    if (ctx.inPart) { problems.push(`${where}: a part does not use a part`); return []; }
    const blocks = ctx.parts?.[name];
    if (!blocks) { problems.push(`${where}: no part ${name} in .workflow/ask-parts`); return []; }
    const values = raw.with && typeof raw.with === "object" ? raw.with : {};
    return list(fill(blocks, values)).flatMap((each, i) => block(each, `${where} (part ${name}, block ${i + 1})`, problems, { ...ctx, inPart: true }));
  }
  if (ctx.off.has(type)) return [];
  const title = str(raw.title);
  const note = str(raw.note);
  if (title.length > BLOCK_LIMITS.title) problems.push(`${where}: a title is at most ${BLOCK_LIMITS.title} characters`);
  if (note.length > BLOCK_LIMITS.note) problems.push(`${where}: a note is at most ${BLOCK_LIMITS.note} characters`);
  const base = { type, title, note, id: str(raw.id) };
  switch (type) {
    case "questions":
      return [base];
    case "text": {
      const source = str(raw.text);
      if (!source.trim()) problems.push(`${where}: a text block has text`);
      if (source.length > BLOCK_LIMITS.text) problems.push(`${where}: a text block is at most ${BLOCK_LIMITS.text} characters; split it`);
      return [{ ...base, source, nodes: parseText(source) }];
    }
    case "stats": {
      const items = list(raw.items).map((it, i) => {
        const value = str(it?.value);
        const tone = str(it?.tone);
        if (!str(it?.label)) problems.push(`${where}: tile ${i + 1} has a label`);
        if (value.length > BLOCK_LIMITS.stat) problems.push(`${where}: tile ${i + 1}'s value is at most ${BLOCK_LIMITS.stat} characters`);
        if (!TONES.includes(tone)) problems.push(`${where}: tile ${i + 1}'s tone is ok, warn, bad, or info`);
        // A trend is a few numbers drawn as a sparkline under the value.
        const trend = it?.trend == null ? null : list(it.trend);
        if (trend && (!trend.length || trend.length > BLOCK_LIMITS.trend || !trend.every((n) => typeof n === "number" && Number.isFinite(n)))) problems.push(`${where}: tile ${i + 1}'s trend is one to ${BLOCK_LIMITS.trend} numbers`);
        return { label: str(it?.label), value, tone, note: str(it?.note), ...(trend?.length ? { trend: trend.slice(0, BLOCK_LIMITS.trend) } : {}) };
      });
      if (!items.length) problems.push(`${where}: a stats block lists its items`);
      return [{ ...base, items }];
    }
    case "table": {
      let data;
      let empty = "";
      if (raw.source != null) {
        const got = ctx.source(str(raw.source), raw);
        if (!got) {
          problems.push(`${where}: no source ${str(raw.source)}; the kit's are open-questions, decisions, and ledger`);
          return [];
        }
        data = tableData({ columns: got.columns, rows: got.rows }, where, problems);
        empty = got.empty ?? "";
      } else data = tableData(raw, where, problems);
      if (!data.columns.length) problems.push(`${where}: a table has columns, or rows with keys`);
      return [{ ...base, source: str(raw.source), columns: data.columns, rows: data.rows, empty, sort: raw.sort !== false, filter: raw.filter ?? data.rows.length > 8 }];
    }
    case "diff": {
      const by = raw.by === "word" ? "word" : "line";
      const before = str(raw.before);
      const after = str(raw.after);
      const size = (s) => (by === "word" ? s.split(/\s+/).length : s.split("\n").length);
      if (size(before) > BLOCK_LIMITS.diff || size(after) > BLOCK_LIMITS.diff) {
        problems.push(`${where}: a diff compares at most ${BLOCK_LIMITS.diff} ${by}s a side`);
        return [];
      }
      return [{ ...base, by, view: raw.view === "inline" ? "inline" : "side", labels: [str(raw.labels?.[0] || "Before"), str(raw.labels?.[1] || "After")], ops: diffOps(before, after, by) }];
    }
    case "chart":
      return [{ ...base, ...chartData(raw, where, problems) }];
    case "diagram":
      return [{ ...base, ...diagramData(raw, where, problems) }];
    case "timeline": {
      const events = list(raw.events).map((e, i) => {
        const state = str(e?.state);
        if (!str(e?.title)) problems.push(`${where}: event ${i + 1} has a title`);
        if (!STATES.includes(state)) problems.push(`${where}: event ${i + 1}'s state is done, now, or next`);
        return { date: str(e?.date), title: str(e?.title), note: str(e?.note), state };
      });
      if (!events.length) problems.push(`${where}: a timeline lists its events`);
      if (events.length > BLOCK_LIMITS.events) problems.push(`${where}: at most ${BLOCK_LIMITS.events} events`);
      return [{ ...base, events: events.slice(0, BLOCK_LIMITS.events) }];
    }
    case "board": {
      const lanes = list(raw.columns).map((c, i) => (typeof c === "string" ? { id: c, title: c } : { id: str(c?.id || c?.title || `c${i + 1}`), title: str(c?.title || c?.id) }));
      if (!lanes.length) problems.push(`${where}: a board lists its columns`);
      if (lanes.length > BLOCK_LIMITS.lanes) problems.push(`${where}: at most ${BLOCK_LIMITS.lanes} columns`);
      const ids = lanes.map((l) => l.id);
      const cards = list(raw.cards).map((c, i) => {
        if (!str(c?.title)) problems.push(`${where}: card ${i + 1} has a title`);
        if (!ids.includes(str(c?.column))) problems.push(`${where}: card ${i + 1}'s column is one of ${ids.join(", ") || "the columns"}`);
        if (!TONES.includes(str(c?.tone))) problems.push(`${where}: card ${i + 1}'s tone is ok, warn, bad, or info`);
        return { title: str(c?.title), column: str(c?.column), note: str(c?.note), tone: str(c?.tone), owner: str(c?.owner), tags: list(c?.tags).map(str).slice(0, 6) };
      });
      if (cards.length > BLOCK_LIMITS.cards) problems.push(`${where}: at most ${BLOCK_LIMITS.cards} cards`);
      return [{ ...base, lanes, cards: cards.slice(0, BLOCK_LIMITS.cards) }];
    }
    default:
      return [];
  }
}

/**
 * A chart's data: `labels` along the bottom, and `series`, each a `name` and
 * one value (or null, a gap) for each label. One axis only: series that need
 * another scale belong in a chart of their own.
 */
function chartData(raw, where, problems) {
  const kind = str(raw.kind || "bar");
  if (!CHART_KINDS.includes(kind)) problems.push(`${where}: a chart's kind is bar or line; a sparkline is a stats tile's trend`);
  const labels = list(raw.labels).map(str);
  if (!labels.length) problems.push(`${where}: a chart has labels, one for each point`);
  if (labels.length > BLOCK_LIMITS.points) problems.push(`${where}: at most ${BLOCK_LIMITS.points} points`);
  if (labels.some((l) => l.length > BLOCK_LIMITS.label)) problems.push(`${where}: a label is at most ${BLOCK_LIMITS.label} characters`);
  const series = list(raw.series).map((s, i) => {
    const values = list(s?.values);
    if (values.length !== labels.length || !values.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)))) problems.push(`${where}: series ${i + 1} has one number, or null, for each label`);
    return { name: str(s?.name || `Series ${i + 1}`), values: values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)) };
  });
  if (!series.length) problems.push(`${where}: a chart lists its series`);
  if (series.length > BLOCK_LIMITS.series) problems.push(`${where}: at most ${BLOCK_LIMITS.series} series; fold the rest into "Other", or split the chart`);
  const stacked = raw.stacked === true;
  if (stacked && kind !== "bar") problems.push(`${where}: only a bar chart stacks`);
  if (stacked && series.some((s) => s.values.some((v) => v < 0))) problems.push(`${where}: a stacked chart has no values below 0`);
  return { kind, labels, series: series.slice(0, BLOCK_LIMITS.series), stacked, unit: str(raw.unit) };
}

/**
 * A diagram: boxes (`nodes` of id, label, note, tone) and arrows (`links` of
 * from, to, label), laid out here in ranks: each box one rank past the
 * furthest box that points to it, in the order the spec lists them. An
 * arrow that points back, closing a loop, is drawn as one, not ranked.
 */
function diagramData(raw, where, problems) {
  const nodes = list(raw.nodes).map((n, i) => (typeof n === "string" ? { id: n, label: n } : n)).map((n, i) => {
    if (!str(n?.id)) problems.push(`${where}: node ${i + 1} has an id`);
    if (!TONES.includes(str(n?.tone))) problems.push(`${where}: node ${i + 1}'s tone is ok, warn, bad, or info`);
    return { id: str(n?.id), label: str(n?.label || n?.id), note: str(n?.note), tone: str(n?.tone) };
  });
  if (!nodes.length) problems.push(`${where}: a diagram lists its nodes`);
  if (nodes.length > BLOCK_LIMITS.nodes) problems.push(`${where}: at most ${BLOCK_LIMITS.nodes} nodes; split it`);
  const ids = nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) problems.push(`${where}: node ids repeat`);
  const links = list(raw.links).map((l, i) => {
    const from = str(l?.from);
    const to = str(l?.to);
    if (!ids.includes(from) || !ids.includes(to)) problems.push(`${where}: link ${i + 1} goes from a node to a node`);
    return { from, to, label: str(l?.label) };
  }).filter((l) => ids.includes(l.from) && ids.includes(l.to));
  if (links.length > BLOCK_LIMITS.links) problems.push(`${where}: at most ${BLOCK_LIMITS.links} links`);
  const direction = raw.direction === "down" ? "down" : "right";
  return { direction, ...layout(nodes, links) };
}

/** Ranks and orders for a diagram's boxes; arrows that close a loop are marked back. */
export function layout(nodes, links) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const [i, l] of links.entries()) out.get(l.from).push(i);
  // Arrows that close a loop, found by a walk in the spec's order, are left out of the ranking.
  const back = new Set();
  const state = new Map();
  const walk = (id) => {
    state.set(id, 1);
    for (const i of out.get(id)) {
      const to = links[i].to;
      if (state.get(to) === 1) back.add(i);
      else if (!state.has(to)) walk(to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) walk(n.id);
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  // The longest path from a box with nothing pointing to it; at most one pass a box.
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const [i, l] of links.entries()) {
      if (back.has(i) || l.from === l.to) continue;
      if (rank.get(l.to) < rank.get(l.from) + 1) { rank.set(l.to, rank.get(l.from) + 1); moved = true; }
    }
    if (!moved) break;
  }
  // Within a rank, boxes sit near the average place of what points to them, else in spec order.
  const order = new Map();
  const ranks = Math.max(0, ...rank.values()) + 1;
  for (let r = 0; r < ranks; r++) {
    const here = nodes.filter((n) => rank.get(n.id) === r);
    const place = (n) => {
      const from = links.filter((l, i) => !back.has(i) && l.to === n.id && order.has(l.from)).map((l) => order.get(l.from));
      return from.length ? from.reduce((a, b) => a + b, 0) / from.length : index.get(n.id) / nodes.length;
    };
    here.map((n) => [n, place(n)]).sort((a, b) => a[1] - b[1] || index.get(a[0].id) - index.get(b[0].id)).forEach(([n], i) => order.set(n.id, i));
  }
  return {
    nodes: nodes.map((n) => ({ ...n, rank: rank.get(n.id), order: order.get(n.id) })),
    links: links.map((l, i) => ({ ...l, back: back.has(i) || l.from === l.to })),
  };
}

/** What a page leaves out: the project's `ask.off` and the page's `off`, less the page's `on`. */
export function offFor(raw, config, problems) {
  const known = [...BLOCK_KINDS.filter((k) => k !== "questions" && k !== "part"), ...RICH_TYPES, ...FEATURES];
  const names = (value, where) => list(value).map(str).filter((name) => {
    if (known.includes(name)) return true;
    problems.push(`${where}: "${name}" is not a block kind, a question type, or a page feature; the ones that turn off are ${known.join(", ")}`);
    return false;
  });
  const off = new Set([...names(config?.ask?.off, "ask.off in .workflow/config.json"), ...names(raw.off, "off")]);
  for (const name of names(raw.on, "on")) off.delete(name);
  return off;
}

/**
 * The page's sections, checked and made ready: `[{ title, note, blocks }]`,
 * or null when the spec gives no blocks. One `questions` block at most; with
 * none, the questions come after the blocks.
 */
export function sectionsOf(raw, problems, ctx) {
  if (raw.blocks == null && raw.sections == null) return null;
  if (raw.blocks != null && raw.sections != null) problems.push("a spec gives blocks or sections, not both");
  const given = raw.sections != null ? list(raw.sections) : [{ blocks: raw.blocks }];
  let count = 0;
  const sections = given.map((section, s) => {
    const where = raw.sections != null ? `sections ${s + 1}` : "blocks";
    const blocks = list(section?.blocks).flatMap((each, i) => block(each, `${where} block ${i + 1}`, problems, ctx));
    count += blocks.length;
    return { title: str(section?.title), note: str(section?.note), blocks };
  }).filter((section) => section.blocks.length || section.title);
  if (count > BLOCK_LIMITS.blocks) problems.push(`${count} blocks; a page holds at most ${BLOCK_LIMITS.blocks}`);
  const placed = sections.flatMap((s) => s.blocks).filter((b) => b.type === "questions").length;
  if (placed > 1) problems.push("the questions go in one place: one questions block at most");
  if (!placed) sections.push({ title: "", note: "", blocks: [{ type: "questions", title: "", note: "", id: "" }] });
  return sections;
}
