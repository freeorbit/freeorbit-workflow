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
export const BLOCK_KINDS = ["text", "stats", "table", "diff", "questions", "part"];
/** Page features a page or a project can turn off. */
export const FEATURES = ["bulk", "outline", "palette", "pins", "compare", "regions", "followups", "owners"];
/** The richer question types, which a page or a project can turn off too. */
export const RICH_TYPES = ["scale", "grid", "buckets", "edits", "form"];
export const BLOCK_LIMITS = { blocks: 60, rows: 500, columns: 20, cell: 300, text: 4000, title: 100, note: 300, stat: 24, diff: 2000 };
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
        return { label: str(it?.label), value, tone, note: str(it?.note) };
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
    default:
      return [];
  }
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
