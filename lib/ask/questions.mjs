// One question of a spec checked: its type, options, pictures, rows,
// fields, owners, and follow-up condition, with the sizes each keeps to.

import { diffOps, diffProblem, list, RICH_TYPES, str } from "./blocks.mjs";
import { RULES } from "./rules.mjs";

export const TYPES = ["one", "many", "text", "rank", ...RICH_TYPES];
/** Sizes the richer questions keep to, so one question stays one question. */
export const ANSWER_LIMITS = { rows: 40, edits: 30, fields: 20, owners: 12, owner: 40, steps: 1000 };
const FIELD_KINDS = ["text", "long", "number", "check", "select", "date"];
export const DECIDE = ["agent", "later"];
const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;


/** A picture as the page shows it: the file, a label, a name, and boxes of x, y, width, height. */
function picture(raw, where, problems) {
  if (!raw || typeof raw !== "object" || typeof raw.image !== "string" || !raw.image) {
    problems.push(`${where}: a picture has an image, a path from the project root`);
    return null;
  }
  const boxes = [];
  for (const [i, box] of list(raw.boxes).entries()) {
    const rect = list(box?.rect);
    if (rect.length !== 4 || !rect.every((n) => Number.isFinite(n) && n >= 0)) {
      problems.push(`${where}: box ${i + 1}'s rect is [x, y, width, height] in the picture's pixels`);
      continue;
    }
    boxes.push({ n: box.n ?? i + 1, kind: str(box.kind || "look"), rect, text: str(box.text) });
  }
  return { image: raw.image, label: str(raw.label), name: str(raw.name), boxes };
}

function option(raw, where, problems) {
  if (typeof raw === "string") raw = { id: raw, label: raw };
  if (!raw || !QID.test(str(raw.id))) {
    problems.push(`${where}: an option has an id of letters, digits, dots, dashes, or underscores`);
    return null;
  }
  // A glyph of its own, one or two characters, where the kind's would mislead, such as ✕ for Drop.
  return { id: raw.id, label: str(raw.label || raw.id), why: str(raw.why), preview: str(raw.preview), kind: str(raw.kind), ...(raw.glyph ? { glyph: [...str(raw.glyph)].slice(0, 2).join("") } : {}) };
}

/** A row of a grid or an item to sort: an id, a label, and why. */
function row(raw, where, problems) {
  if (typeof raw === "string") raw = { id: raw, label: raw };
  if (!raw || !QID.test(str(raw.id))) {
    problems.push(`${where}: a row has an id of letters, digits, dots, dashes, or underscores`);
    return null;
  }
  return { id: raw.id, label: str(raw.label || raw.id), why: str(raw.why) };
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const unique = (items, where, what, problems) => {
  const ids = items.map((each) => each.id);
  if (new Set(ids).size !== ids.length) problems.push(`${where}: ${what} ids repeat`);
};

/** A recommendation that places rows: `{ rowId: optionId }`, every key a row and every value one of `values`. */
function placing(rec, rows, values, where, problems, what) {
  if (rec == null) return null;
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    problems.push(`${where}: recommended is { ${what}: … }, one for each ${what} it recommends`);
    return null;
  }
  const ids = rows.map((each) => each.id);
  const bad = Object.entries(rec).filter(([k, v]) => !ids.includes(k) || !values.includes(v));
  if (bad.length) problems.push(`${where}: recommended places ${bad.map(([k]) => k).join(", ")} on something it does not have`);
  return Object.keys(rec).length ? { ...rec } : null;
}

/** The parts of the richer types: a scale's range, a grid's or a sort's rows, edits, and form fields. */
function rich(out, raw, where, problems, ids) {
  const type = out.type;
  const rec = raw.recommended;
  if (type === "scale") {
    const s = raw.scale && typeof raw.scale === "object" ? raw.scale : {};
    const min = s.min ?? 1;
    const max = s.max ?? 5;
    const step = s.step ?? 1;
    if (![min, max, step].every(finite) || max <= min || step <= 0) problems.push(`${where}: a scale runs from min to a larger max by a step above 0`);
    else if ((max - min) / step > ANSWER_LIMITS.steps) problems.push(`${where}: a scale has at most ${ANSWER_LIMITS.steps} steps`);
    const whole = Number.isInteger(min) && Number.isInteger(step) && step === 1;
    const style = s.style ?? (whole && min >= 0 && max - min <= 9 ? "stars" : "slider");
    if (!["stars", "slider", "number"].includes(style)) problems.push(`${where}: a scale's style is stars, slider, or number`);
    if (style === "stars" && !(whole && max - min <= 9)) problems.push(`${where}: stars count whole steps, ten at most; use a slider or a number`);
    out.scale = { min, max, step, style, low: str(s.low), high: str(s.high), unit: str(s.unit) };
    out.recommended = null;
    if (rec != null) {
      if (!RULES.onScale({ min, max, step }, rec)) problems.push(`${where}: recommended is a number on the scale, not ${JSON.stringify(rec)}`);
      else out.recommended = rec;
    }
    return;
  }
  if (type === "grid" || type === "buckets") {
    const what = type === "grid" ? "row" : "item";
    out.rows = list(type === "grid" ? raw.rows : raw.items ?? raw.rows).map((each, i) => row(each, `${where} ${what} ${i + 1}`, problems)).filter(Boolean);
    if (!out.rows.length) problems.push(`${where}: a ${type} question lists its ${type === "grid" ? "rows" : "items"}`);
    if (out.rows.length > ANSWER_LIMITS.rows) problems.push(`${where}: at most ${ANSWER_LIMITS.rows} ${what}s; split it`);
    unique(out.rows, where, what, problems);
    out.recommended = placing(rec, out.rows, ids, where, problems, what);
    return;
  }
  if (type === "edits") {
    const given = list(raw.edits);
    // Counted before any diff is worked out.
    if (given.length > ANSWER_LIMITS.edits) problems.push(`${where}: at most ${ANSWER_LIMITS.edits} edits; split it`);
    out.edits = given.slice(0, ANSWER_LIMITS.edits).map((each, i) => {
      const at = `${where} edit ${i + 1}`;
      if (!each || !QID.test(str(each.id))) { problems.push(`${at}: an edit has an id`); return null; }
      const by = each.by === "line" ? "line" : "word";
      const before = str(each.before);
      const after = str(each.after);
      if (before === after) problems.push(`${at}: an edit changes something; before and after are the same`);
      const big = diffProblem(before, after, by);
      if (big) { problems.push(`${at}: an edit ${big}`); return null; }
      return { id: each.id, label: str(each.label), why: str(each.why), by, ops: diffOps(before, after, by) };
    }).filter(Boolean);
    if (!out.edits.length) problems.push(`${where}: an edits question lists its edits, each a before and an after`);
    unique(out.edits, where, "edit", problems);
    const all = typeof rec === "string" ? Object.fromEntries(out.edits.map((e) => [e.id, rec])) : rec;
    out.recommended = placing(all, out.edits, ["accept", "reject"], where, problems, "edit");
    return;
  }
  if (type === "form") {
    out.fields = list(raw.fields).map((f, i) => {
      const at = `${where} field ${i + 1}`;
      if (!f || !QID.test(str(f.id))) { problems.push(`${at}: a field has an id`); return null; }
      const kind = f.kind ?? "text";
      if (!FIELD_KINDS.includes(kind)) problems.push(`${at}: kind is one of ${FIELD_KINDS.join(", ")}`);
      const options = kind === "select" ? list(f.options).map((o, j) => option(o, `${at} option ${j + 1}`, problems)).filter(Boolean) : [];
      if (kind === "select" && options.length < 2) problems.push(`${at}: a select field has at least two options`);
      for (const k of ["min", "max"]) if (f[k] != null && !finite(f[k])) problems.push(`${at}: ${k} is a number`);
      return { id: f.id, label: str(f.label || f.id), kind, required: f.required === true, options, min: f.min ?? null, max: f.max ?? null, help: str(f.help), placeholder: str(f.placeholder) };
    }).filter(Boolean);
    if (!out.fields.length) problems.push(`${where}: a form lists its fields`);
    if (out.fields.length > ANSWER_LIMITS.fields) problems.push(`${where}: at most ${ANSWER_LIMITS.fields} fields; split it`);
    unique(out.fields, where, "field", problems);
    if (rec != null) problems.push(`${where}: a form recommends nothing; say what fits in each field's help`);
    out.recommended = null;
  }
}

/** Who a question can be assigned to. */
function owners(out, raw, where, problems) {
  if (raw.owners == null) return;
  const names = list(raw.owners).map(str).filter(Boolean);
  if (!names.length || names.length > ANSWER_LIMITS.owners || names.some((n) => n.length > ANSWER_LIMITS.owner)) problems.push(`${where}: owners lists one to ${ANSWER_LIMITS.owners} names, each at most ${ANSWER_LIMITS.owner} characters`);
  if (new Set(names).size !== names.length) problems.push(`${where}: owners repeat`);
  out.owners = names.slice(0, ANSWER_LIMITS.owners);
}

/** A follow-up's condition, checked against the earlier question in normalize. */
function condition(raw, where, problems) {
  if (!raw || typeof raw !== "object" || !QID.test(str(raw.question))) {
    problems.push(`${where}: showIf names an earlier question, as { "question": "<id>", "is": "<option>" }`);
    return null;
  }
  const ids = (value) => (value == null ? null : (Array.isArray(value) ? value : [value]).map(str));
  const out = { question: raw.question, is: ids(raw.is), not: ids(raw.not), atLeast: raw.atLeast ?? null, atMost: raw.atMost ?? null };
  for (const k of ["atLeast", "atMost"]) if (out[k] != null && !finite(out[k])) problems.push(`${where}: showIf's ${k} is a number`);
  return out;
}

/** Each follow-up names an earlier question, and what it names fits that question. */
export function followUpProblems(questions) {
  const problems = [];
  const seen = new Map();
  for (const q of questions) {
    const c = q.showIf;
    if (c) {
      const parent = seen.get(c.question);
      if (!parent) problems.push(`${q.id}: showIf names ${c.question}, which is not an earlier question on this page`);
      else {
        const known = [...parent.options.map((o) => o.id), ...(parent.other ? ["other"] : [])];
        const picks = parent.type === "one" || parent.type === "many";
        for (const k of ["is", "not"]) {
          if (!c[k]) continue;
          if (!picks) problems.push(`${q.id}: showIf's ${k} needs a one or many question; ${parent.id} is ${parent.type}`);
          else if (!c[k].every((id) => known.includes(id))) problems.push(`${q.id}: showIf's ${k} names options ${parent.id} does not have`);
        }
        if ((c.atLeast != null || c.atMost != null) && parent.type !== "scale") problems.push(`${q.id}: showIf's atLeast and atMost need a scale; ${parent.id} is ${parent.type}`);
      }
    }
    seen.set(q.id, q);
  }
  return problems;
}

/** One question in the plain shape, from a decision-style entry. */
export function question(raw, where, problems) {
  if (!raw || typeof raw !== "object") {
    problems.push(`${where}: a question is an object`);
    return null;
  }
  const type = raw.type ?? (raw.options ? "one" : "text");
  const out = {
    id: str(raw.id),
    text: str(raw.text),
    type,
    why: str(raw.why),
    look: str(raw.look),
    role: str(raw.role),
    group: str(raw.group),
    chunk: str(raw.chunk),
    record: str(raw.record),
    detail: str(raw.detail),
    noPick: str(raw.noPick),
    explain: raw.explain === true,
    other: raw.other === true,
    pins: raw.pins === true,
    defer: raw.defer !== false,
    options: [],
    recommended: raw.recommended ?? null,
    pictures: [],
    compare: null,
    cells: list(raw.cells).map(str),
    columns: list(raw.columns).map(str),
    table: str(raw.table),
    rows: [],
    edits: [],
    fields: [],
    scale: null,
    owners: [],
    showIf: null,
  };
  if (!QID.test(out.id)) problems.push(`${where}: id "${out.id}" is letters, digits, dots, dashes, or underscores, at most 64`);
  if (!out.text) problems.push(`${where}: ${out.id || "a question"} has no text`);
  if (!TYPES.includes(type)) problems.push(`${where}: type is one of ${TYPES.join(", ")}, not ${type}`);
  out.options = list(raw.options).map((each, i) => option(each, `${where} option ${i + 1}`, problems)).filter(Boolean);
  if (["one", "many", "rank", "grid", "buckets"].includes(type) && out.options.length < 2) problems.push(`${where}: a ${type} question has at least two options${type === "buckets" ? ", the buckets" : type === "grid" ? ", the columns" : ""}`);
  const ids = out.options.map((each) => each.id);
  if (new Set(ids).size !== ids.length) problems.push(`${where}: option ids repeat`);
  rich(out, raw, where, problems, ids);
  owners(out, raw, where, problems);
  if (raw.showIf != null) out.showIf = condition(raw.showIf, where, problems);
  const rec = out.recommended;
  if (RICH_TYPES.includes(type)) {
    // The richer types check their own recommendation, in rich().
  } else if (rec != null) {
    const recs = Array.isArray(rec) ? rec : [rec];
    if (type === "text" || type === "rank" || !recs.every((each) => ids.includes(each))) problems.push(`${where}: recommended names its options, not ${JSON.stringify(rec)}`);
    if (type === "one" && Array.isArray(rec)) problems.push(`${where}: a one question recommends one option`);
  }
  out.pictures = list(raw.pictures).map((each, i) => picture(each, `${where} picture ${i + 1}`, problems)).filter(Boolean);
  if (raw.compare) {
    const pair = list(raw.compare).map((each, i) => picture(each, `${where} compare ${i + 1}`, problems)).filter(Boolean);
    if (pair.length !== 2) problems.push(`${where}: compare is two pictures, the frame or before first`);
    else out.compare = pair;
  }
  return out;
}
