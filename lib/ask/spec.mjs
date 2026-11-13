// An ask page's spec: what `wf ask page` reads. A spec names a template and
// its items, and each template expands into plain questions, so the page,
// the answers, and the record read one shape.
//
//   { "id": "chunk-38c2-start", "title": "Chunk 38c2", "template": "decision",
//     "questions": [{ "id": "layout", "text": "Which layout?", "type": "one",
//                     "options": [{ "id": "a", "label": "Tabs", "why": "…" }, …],
//                     "recommended": "a", "why": "…" }] }
//
// A question's type is one (pick one), many (pick any), text, or rank; or
// one of the richer ones: scale (stars, a slider, or a number), grid (a
// choice for each row), buckets (sort items into the options), edits
// (accept or reject each suggested change), or form (a few fields). Any
// question may carry pictures, a compare pair, pins, a role, a group, a
// "look" line saying where to look, "record", the decisions file its
// answer goes to, `owners` to assign it to, and `showIf`, which makes it a
// follow-up that shows when an earlier answer fits. The examples are in plugins/core/skills/ask-page/examples.
//
// A question that asks for a choice recommends one and says why, as the
// asking rules say: in the decision, batch, naming, and triage templates,
// `recommended` and `why`, with a `why` on every option saying what it
// means, and in rank, `why` for the suggested order (the
// order the items are listed in). When there is honestly nothing to
// recommend, `noPick` says why instead, and the page shows it. The review
// templates' verdicts are the person's own, so they recommend nothing.

import { createHash } from "node:crypto";

import { BLOCK_LIMITS, FEATURES, RICH_TYPES, diffOps, offFor, sectionsOf } from "./blocks.mjs";

export const TYPES = ["one", "many", "text", "rank", ...RICH_TYPES];
/** Sizes the richer questions keep to, so one question stays one question. */
export const ANSWER_LIMITS = { rows: 40, edits: 30, fields: 20, owners: 12, owner: 40, steps: 1000 };
const FIELD_KINDS = ["text", "long", "number", "check", "select", "date"];
export const DECIDE = ["agent", "later"];
export { ID } from "../view/serve.mjs";
import { ID } from "../view/serve.mjs";
const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_QUESTIONS = 300;

const nth = (each, i, prefix) => each?.id ?? `${prefix}${i + 1}`;
const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * Every kit template, each in one record: what it is for (`use`), how its
 * page is laid out, the spec's field that lists its items, its verdicts when
 * it has its own, whether its choices carry a recommendation (`advised`),
 * and how its items expand into plain questions. `expand` gets the items,
 * the verdicts to use (the spec's own, or the template's), the spec, and the
 * problems list. Adding a template is adding a record and its example.
 */
export const TEMPLATES = {
  decision: {
    layout: "list", items: "questions", advised: true,
    use: "Pick one of several plans or answers, each with a preview, a recommendation, and why.",
    expand: (items) => items.map((each) => ({ ...each, group: each?.group || "" })),
  },
  compare: {
    layout: "pages", items: "pairs",
    use: "A frame against the app, or before against after: side by side, swipe, onion skin, or difference, with a verdict per pair.",
    verdicts: [
      { id: "match", label: "Matches", kind: "ok" },
      { id: "drift", label: "Drifts from the frame", kind: "drift" },
      { id: "bug", label: "A bug", kind: "bug" },
      { id: "better", label: "Different, and the app is right", kind: "new" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "pair-"), text: each?.text || `${each?.label || `Pair ${i + 1}`}: do these match?`, type: "one", options: verdicts, compare: [each?.left, each?.right], pins: true, look: each?.look, detail: each?.detail, role: each?.role })),
  },
  "frame-review": {
    layout: "pages", items: "frames",
    use: "Each frame marked fine, bug, drift, or look here, with pins on the picture.",
    verdicts: [
      { id: "ok", label: "Fine", kind: "ok" },
      { id: "bug", label: "Bug", kind: "bug" },
      { id: "drift", label: "Drift", kind: "drift" },
      { id: "look", label: "Look again", kind: "look" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "frame-"), text: each?.text || `${each?.name || `Frame ${i + 1}`}: how is it?`, type: "one", options: verdicts, pictures: [{ ...each, label: each?.label ?? String(i + 1) }], pins: true, look: each?.look, group: each?.area, detail: each?.detail })),
  },
  storyboard: {
    layout: "pages", items: "steps",
    use: "A flow's screens in order; each step passes or breaks.",
    verdicts: [
      { id: "ok", label: "This step works", kind: "ok" },
      { id: "breaks", label: "This step breaks", kind: "bug" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "step-"), text: each?.caption || each?.name || `Step ${i + 1}`, type: "one", options: verdicts, pictures: each?.image ? [{ image: each.image, name: each.name, label: String(i + 1), boxes: each.boxes }] : [], pins: Boolean(each?.image), look: each?.look })),
  },
  batch: {
    layout: "groups", items: "questions", advised: true,
    use: "A chunk's questions at once, grouped by the role that owns each.",
    expand: (items, verdicts, spec, problems) => {
      items.forEach((each, i) => { if (!each?.role) problems.push(`questions ${i + 1}: a batch question names the role that owns it`); });
      return items.map((each) => ({ ...each, group: each?.group || each?.role }));
    },
  },
  triage: {
    layout: "list", items: "items", advised: true,
    use: "Answer, defer, or drop each open question.",
    verdicts: [
      { id: "answer", label: "Answer it now", why: "Write the answer in the note; it is resolved with that answer." },
      { id: "defer", label: "Keep it open", why: "It stays in the open questions log until its chunk or trigger." },
      { id: "drop", label: "Drop it", why: "No longer a question; it is resolved as none, with the note as the reason." },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "item-"), text: `${each?.id ? `${each.id}: ` : ""}${each?.text || ""}`, detail: each?.context, type: "one", options: verdicts, role: each?.needs || each?.role, chunk: each?.chunk, recommended: each?.recommended, why: each?.why, noPick: each?.noPick })),
  },
  rank: {
    layout: "list", items: "items", advised: true,
    use: "Put items in order, such as priorities or build order.",
    expand: (items, verdicts, spec) => [{ id: spec.rankId || "order", text: spec.prompt || "Put these in order, first at the top.", type: "rank", options: items.map((each, i) => (typeof each === "string" ? { id: `item-${i + 1}`, label: each } : { id: nth(each, i, "item-"), label: each?.label, why: each?.why })), why: spec.why, noPick: spec.noPick, defer: false }],
  },
  naming: {
    layout: "list", items: "items", advised: true,
    use: "Pick or write a label or a line of text, on the screen it sits on.",
    expand: (items) => items.map((each, i) => ({ id: nth(each, i, "name-"), text: `${each?.where || `Label ${i + 1}`}: which words?`, detail: each?.current ? `Now: “${each.current}”` : "", type: "one", options: listOf(each?.options), recommended: each?.recommended, why: each?.why, noPick: each?.noPick, other: true, pictures: each?.picture ? [each.picture] : [], look: each?.look })),
  },
  testdata: {
    layout: "table", items: "tables",
    use: "Rule tables from the test-data check: each row fine, a gap, or wrong.",
    verdicts: [
      { id: "ok", label: "Fine", kind: "ok" },
      { id: "gap", label: "A gap", kind: "drift" },
      { id: "wrong", label: "Wrong", kind: "bug" },
    ],
    expand: (items, verdicts) => items.flatMap((table, t) => listOf(table?.rows).map((row, r) => ({ id: `${table?.id ?? `table-${t + 1}`}.${row?.id ?? r + 1}`, text: row?.id ?? `Row ${r + 1}`, type: "one", options: verdicts, cells: row?.cells, columns: table?.columns, table: table?.title || table?.id || `Table ${t + 1}`, defer: false }))),
  },
  plan: {
    layout: "list", items: "steps",
    use: "Approve each step of a plan or ask for a change, then the plan as a whole.",
    verdicts: [
      { id: "approve", label: "Approve", kind: "ok" },
      { id: "change", label: "Change it (say how in the note)", kind: "drift" },
    ],
    expand: (items, verdicts, spec) => [
      ...items.map((each, i) => ({ id: nth(each, i, "step-"), text: typeof each === "string" ? each : each?.text || "", detail: each?.detail, type: "one", options: verdicts, defer: false })),
      { id: "plan", text: spec.prompt || "The plan as a whole", type: "one", options: [{ id: "go", label: "Go ahead", kind: "ok" }, { id: "redo", label: "Rework it first", kind: "drift" }], recommended: "go", defer: false },
    ],
  },
  signoff: {
    layout: "list", items: "checks",
    use: "Tick each check, or object to it with a reason.",
    verdicts: [
      { id: "done", label: "Done", kind: "ok" },
      { id: "object", label: "Object (say why in the note)", kind: "bug" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "check-"), text: typeof each === "string" ? each : each?.text || "", detail: each?.detail, type: "one", options: verdicts, defer: false })),
  },
};

/** A page's hash: its shape, and the bytes of its pictures when it has any. Answers name it. */
export function pageHash(shape, digests = []) {
  return createHash("sha256").update(JSON.stringify(shape)).update(digests.join()).digest("hex").slice(0, 12);
}

const text = (value) => (value == null ? "" : String(value));
const list = (value) => (Array.isArray(value) ? value : []);

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
    boxes.push({ n: box.n ?? i + 1, kind: text(box.kind || "look"), rect, text: text(box.text) });
  }
  return { image: raw.image, label: text(raw.label), name: text(raw.name), boxes };
}

function option(raw, where, problems) {
  if (typeof raw === "string") raw = { id: raw, label: raw };
  if (!raw || !QID.test(text(raw.id))) {
    problems.push(`${where}: an option has an id of letters, digits, dots, dashes, or underscores`);
    return null;
  }
  return { id: raw.id, label: text(raw.label || raw.id), why: text(raw.why), preview: text(raw.preview), kind: text(raw.kind) };
}

/** A row of a grid or an item to sort: an id, a label, and why. */
function row(raw, where, problems) {
  if (typeof raw === "string") raw = { id: raw, label: raw };
  if (!raw || !QID.test(text(raw.id))) {
    problems.push(`${where}: a row has an id of letters, digits, dots, dashes, or underscores`);
    return null;
  }
  return { id: raw.id, label: text(raw.label || raw.id), why: text(raw.why) };
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
    out.scale = { min, max, step, style, low: text(s.low), high: text(s.high), unit: text(s.unit) };
    out.recommended = null;
    if (rec != null) {
      if (!finite(rec) || rec < min || rec > max || Math.abs((rec - min) / step - Math.round((rec - min) / step)) > 1e-9) problems.push(`${where}: recommended is a number on the scale, not ${JSON.stringify(rec)}`);
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
    out.edits = list(raw.edits).map((each, i) => {
      const at = `${where} edit ${i + 1}`;
      if (!each || !QID.test(text(each.id))) { problems.push(`${at}: an edit has an id`); return null; }
      const by = each.by === "line" ? "line" : "word";
      const before = text(each.before);
      const after = text(each.after);
      if (before === after) problems.push(`${at}: an edit changes something; before and after are the same`);
      const size = (s) => (by === "word" ? s.split(/\s+/).length : s.split("\n").length);
      if (size(before) > BLOCK_LIMITS.diff || size(after) > BLOCK_LIMITS.diff) { problems.push(`${at}: an edit compares at most ${BLOCK_LIMITS.diff} ${by}s a side`); return null; }
      return { id: each.id, label: text(each.label), why: text(each.why), by, ops: diffOps(before, after, by) };
    }).filter(Boolean);
    if (!out.edits.length) problems.push(`${where}: an edits question lists its edits, each a before and an after`);
    if (out.edits.length > ANSWER_LIMITS.edits) problems.push(`${where}: at most ${ANSWER_LIMITS.edits} edits; split it`);
    unique(out.edits, where, "edit", problems);
    const all = typeof rec === "string" ? Object.fromEntries(out.edits.map((e) => [e.id, rec])) : rec;
    out.recommended = placing(all, out.edits, ["accept", "reject"], where, problems, "edit");
    return;
  }
  if (type === "form") {
    out.fields = list(raw.fields).map((f, i) => {
      const at = `${where} field ${i + 1}`;
      if (!f || !QID.test(text(f.id))) { problems.push(`${at}: a field has an id`); return null; }
      const kind = f.kind ?? "text";
      if (!FIELD_KINDS.includes(kind)) problems.push(`${at}: kind is one of ${FIELD_KINDS.join(", ")}`);
      const options = kind === "select" ? list(f.options).map((o, j) => option(o, `${at} option ${j + 1}`, problems)).filter(Boolean) : [];
      if (kind === "select" && options.length < 2) problems.push(`${at}: a select field has at least two options`);
      for (const k of ["min", "max"]) if (f[k] != null && !finite(f[k])) problems.push(`${at}: ${k} is a number`);
      return { id: f.id, label: text(f.label || f.id), kind, required: f.required === true, options, min: f.min ?? null, max: f.max ?? null, help: text(f.help), placeholder: text(f.placeholder) };
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
  const names = list(raw.owners).map(text).filter(Boolean);
  if (!names.length || names.length > ANSWER_LIMITS.owners || names.some((n) => n.length > ANSWER_LIMITS.owner)) problems.push(`${where}: owners lists one to ${ANSWER_LIMITS.owners} names, each at most ${ANSWER_LIMITS.owner} characters`);
  if (new Set(names).size !== names.length) problems.push(`${where}: owners repeat`);
  out.owners = names.slice(0, ANSWER_LIMITS.owners);
}

/** A follow-up's condition, checked against the earlier question in normalize. */
function condition(raw, where, problems) {
  if (!raw || typeof raw !== "object" || !QID.test(text(raw.question))) {
    problems.push(`${where}: showIf names an earlier question, as { "question": "<id>", "is": "<option>" }`);
    return null;
  }
  const ids = (value) => (value == null ? null : (Array.isArray(value) ? value : [value]).map(text));
  const out = { question: raw.question, is: ids(raw.is), not: ids(raw.not), atLeast: raw.atLeast ?? null, atMost: raw.atMost ?? null };
  for (const k of ["atLeast", "atMost"]) if (out[k] != null && !finite(out[k])) problems.push(`${where}: showIf's ${k} is a number`);
  return out;
}

/** Each follow-up names an earlier question, and what it names fits that question. */
function followUpProblems(questions) {
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
function question(raw, where, problems) {
  if (!raw || typeof raw !== "object") {
    problems.push(`${where}: a question is an object`);
    return null;
  }
  const type = raw.type ?? (raw.options ? "one" : "text");
  const out = {
    id: text(raw.id),
    text: text(raw.text),
    type,
    why: text(raw.why),
    look: text(raw.look),
    role: text(raw.role),
    group: text(raw.group),
    chunk: text(raw.chunk),
    record: text(raw.record),
    detail: text(raw.detail),
    noPick: text(raw.noPick),
    explain: raw.explain === true,
    other: raw.other === true,
    pins: raw.pins === true,
    defer: raw.defer !== false,
    options: [],
    recommended: raw.recommended ?? null,
    pictures: [],
    compare: null,
    cells: list(raw.cells).map(text),
    columns: list(raw.columns).map(text),
    table: text(raw.table),
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

export const LAYOUTS = ["list", "pages", "groups", "table"];
const NAME = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * A project's own template, from `.workflow/ask-templates/<name>.json`: data
 * only, never code, so the page stays the kit's. Checked, or `{ problems }`.
 *
 *   { "name": "dependency-review", "use": "…", "layout": "list", "items": "packages",
 *     "text": "{label}: keep it?", "detail": "{change}", "type": "one",
 *     "options": [{ "id": "keep", "label": "Keep", "why": "…" }, …],
 *     "advised": true, "pins": false, "defer": true, "other": false,
 *     "groupBy": "area", "columns": ["label", "change"] }
 *
 * `{key}` in text and detail is the item's field, and `{n}` its number. An
 * item may give its own options, recommended, why, noPick, image or
 * pictures, left and right (a compare pair), role, look, and id.
 */
export function checkTemplate(raw, file = "a template") {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problems: [`${file}: a template is a JSON object`] };
  if (!NAME.test(text(raw.name))) problems.push(`${file}: name is lowercase letters, digits, and dashes`);
  else if (TEMPLATES[raw.name]) problems.push(`${file}: ${raw.name} is a kit template; a project's has its own name`);
  if (!raw.use) problems.push(`${file}: use says in a sentence what the template is for`);
  if (!LAYOUTS.includes(raw.layout ?? "list")) problems.push(`${file}: layout is one of ${LAYOUTS.join(", ")}`);
  if (!/^[a-z][A-Za-z0-9]*$/.test(text(raw.items))) problems.push(`${file}: items names the spec's field that lists the items, such as "packages"`);
  if (raw.type != null && !TYPES.includes(raw.type)) problems.push(`${file}: type is one of ${TYPES.join(", ")}`);
  if (raw.options != null && !Array.isArray(raw.options)) problems.push(`${file}: options is a list`);
  if (raw.columns != null && (!Array.isArray(raw.columns) || !raw.columns.every((c) => typeof c === "string"))) problems.push(`${file}: columns lists the item fields a table shows`);
  if ((raw.layout ?? "list") === "table" && !raw.columns) problems.push(`${file}: a table template lists its columns`);
  const known = ["name", "use", "layout", "items", "text", "detail", "type", "options", "advised", "pins", "defer", "other", "groupBy", "columns"];
  const extra = Object.keys(raw).filter((key) => !known.includes(key) && !key.startsWith("_"));
  if (extra.length) problems.push(`${file}: unknown fields ${extra.join(", ")}; a template is data only`);
  if (problems.length) return { problems };
  return { template: { ...raw, layout: raw.layout ?? "list", advised: raw.advised === true } };
}

/** A project template's items as plain entries. */
function expandProject(def, spec) {
  const fill = (pattern, item, i) => String(pattern).replace(/\{(\w+)\}/g, (_, key) => (key === "n" ? String(i + 1) : text(item?.[key])));
  const columns = def.columns ?? [];
  return list(spec[def.items]).map((item, i) => {
    const one = typeof item === "string" ? { label: item } : item ?? {};
    return {
      id: one.id ?? `${def.name}-${i + 1}`,
      text: one.text ?? fill(def.text ?? "{label}", one, i),
      detail: one.detail ?? (def.detail ? fill(def.detail, one, i) : ""),
      type: def.type ?? (one.options || def.options ? "one" : "text"),
      options: one.options ?? def.options ?? [],
      recommended: one.recommended,
      why: one.why,
      noPick: one.noPick,
      pictures: one.image ? [{ image: one.image, label: one.label ?? String(i + 1), name: one.name, boxes: one.boxes }] : list(one.pictures),
      compare: one.left && one.right ? [one.left, one.right] : undefined,
      pins: def.pins === true,
      defer: def.defer !== false,
      other: def.other === true,
      role: one.role,
      look: one.look,
      group: def.groupBy ? text(one[def.groupBy]) : one.group,
      cells: columns.map((key) => text(one[key])),
      columns,
      table: def.layout === "table" ? text(one.table || spec.title) : "",
    };
  });
}

/** The template's items as plain decision-style entries, before checking. */
function expand(spec, problems, custom) {
  if (custom[spec.template]) return expandProject(custom[spec.template], spec);
  const def = TEMPLATES[spec.template];
  return def.expand(list(spec[def.items]), spec.verdicts ?? def.verdicts ?? [], spec, problems);
}

/**
 * The spec checked and expanded: `{ spec, problems }`. The spec carries `hash`,
 * which answers name. `custom` is the project's templates by name; `ctx` gives
 * blocks what they need: the project's `config` (for ask.off), its `parts`,
 * and `source(name, block)` for named sources.
 */
export function normalize(raw, custom = {}, ctx = {}) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { spec: null, problems: ["a spec is a JSON object"] };
  const template = raw.template ?? "decision";
  if (!ID.test(text(raw.id))) problems.push(`id "${text(raw.id)}" is lowercase letters, digits, and dashes, at most 64`);
  if (!raw.title) problems.push("a spec has a title");
  const def = TEMPLATES[template] ?? custom[template];
  if (!def) return { spec: null, problems: [...problems, `template is one of ${[...Object.keys(TEMPLATES), ...Object.keys(custom)].join(", ")}, not ${template}`] };
  const field = def.items;
  if (!Array.isArray(raw[field]) || !raw[field].length) problems.push(`a ${template} spec lists its ${field}`);
  const questions = expand({ ...raw, template }, problems, custom)
    .map((each, i) => question(each, `${field} ${i + 1}`, problems))
    .filter(Boolean);
  if (questions.length > MAX_QUESTIONS) problems.push(`${questions.length} questions; a page holds at most ${MAX_QUESTIONS}, so split it`);
  const ids = questions.map((each) => each.id);
  const twice = ids.filter((each, i) => ids.indexOf(each) !== i);
  if (twice.length) problems.push(`question ids repeat: ${[...new Set(twice)].join(", ")}`);
  for (const each of questions) if (each.record && each.type !== "one" && each.type !== "many") problems.push(`${each.id}: only a one or many question records a decision`);
  const off = offFor(raw, ctx.config, problems);
  for (const each of questions) if (off.has(each.type)) problems.push(`${each.id}: ${each.type} questions are turned off here (by off, or ask.off in .workflow/config.json); ask another way, or turn it on`);
  // With follow-ups off every question shows; with owners off none is assigned.
  if (off.has("followups")) for (const each of questions) each.showIf = null;
  if (off.has("owners")) for (const each of questions) each.owners = [];
  problems.push(...followUpProblems(questions));
  if (def.advised) problems.push(...adviceProblems(questions));
  problems.push(...lengthProblems(questions));
  const sections = sectionsOf(raw, problems, { off, parts: ctx.parts ?? {}, source: ctx.source ?? (() => null) });
  const spec = {
    id: text(raw.id),
    title: text(raw.title),
    template,
    layout: def.layout,
    intro: text(raw.intro),
    from: text(raw.from),
    chunk: text(raw.chunk),
    questions,
  };
  if (sections) spec.sections = sections;
  const features = [...off].filter((name) => FEATURES.includes(name));
  if (features.length) spec.off = features;
  spec.hash = pageHash(spec);
  return { spec, problems };
}

/**
 * Wording held short, so every page reads evenly: a question and a label say
 * one thing, and a reason or a description is one sentence. A question with
 * `explain: true`, asked for when the person wants more detail or a follow-up
 * runs deeper, may give its reasons and descriptions room.
 */
export const LIMITS = { text: 160, label: 60, why: 200, optionWhy: 160, detail: 300, look: 200, explained: 1200 };

function lengthProblems(questions) {
  const problems = [];
  const over = (where, value, max) => {
    if (value && value.length > max) problems.push(`${where} is ${value.length} characters, over ${max}; say it shorter${max < LIMITS.explained ? ", or set explain: true where more detail was asked for" : ""}`);
  };
  for (const q of questions) {
    const roomy = (max) => (q.explain ? LIMITS.explained : max);
    over(`${q.id}: the question`, q.text, LIMITS.text);
    over(`${q.id}: why`, q.why, roomy(LIMITS.why));
    over(`${q.id}: noPick`, q.noPick, roomy(LIMITS.why));
    over(`${q.id}: detail`, q.detail, roomy(LIMITS.detail));
    over(`${q.id}: look`, q.look, LIMITS.look);
    for (const o of q.options) {
      over(`${q.id}: option ${o.id}'s label`, o.label, LIMITS.label);
      over(`${q.id}: option ${o.id}'s why`, o.why, roomy(LIMITS.optionWhy));
    }
    for (const r of q.rows) {
      over(`${q.id}: ${r.id}'s label`, r.label, LIMITS.text);
      over(`${q.id}: ${r.id}'s why`, r.why, roomy(LIMITS.optionWhy));
    }
    for (const e of q.edits) {
      over(`${q.id}: edit ${e.id}'s label`, e.label, LIMITS.label);
      over(`${q.id}: edit ${e.id}'s why`, e.why, roomy(LIMITS.optionWhy));
    }
    for (const f of q.fields) {
      over(`${q.id}: field ${f.id}'s label`, f.label, LIMITS.label);
      over(`${q.id}: field ${f.id}'s help`, f.help, roomy(LIMITS.optionWhy));
    }
    if (q.scale) for (const k of ["low", "high"]) over(`${q.id}: the scale's ${k}`, q.scale[k], LIMITS.label);
  }
  return problems;
}

/** A choice with no recommendation and why, or a noPick with one, by the asking rules. */
function adviceProblems(questions) {
  const problems = [];
  for (const q of questions) {
    if (q.type === "text" || q.type === "form") continue;
    // Each edit says why it is suggested, as each option says what it means.
    const bareEdits = q.edits.filter((each) => !each.why).map((each) => each.id);
    if (bareEdits.length) problems.push(`${q.id}: every edit says why it is suggested, in why; ${bareEdits.join(", ")} ${bareEdits.length === 1 ? "does" : "do"} not`);
    // Each option says what it means, so the ones not recommended are understood too.
    const bare = q.options.filter((each) => !each.why).map((each) => each.id);
    if (bare.length) problems.push(`${q.id}: every option says what it means, in why; ${bare.join(", ")} ${bare.length === 1 ? "does" : "do"} not`);
    const what = q.type === "rank" ? "a suggested order" : "a recommendation";
    if (q.noPick) {
      if (q.recommended != null) problems.push(`${q.id}: noPick says there is no recommendation, but it recommends ${JSON.stringify(q.recommended)}`);
      continue;
    }
    const how = { scale: "give the number", grid: "place the rows", buckets: "place the items", edits: "accept or reject the edits" }[q.type] ?? "name the option";
    if (q.type !== "rank" && q.recommended == null) problems.push(`${q.id}: ${what}: ${how} in recommended, or say in noPick why there is none`);
    if (!q.why) problems.push(`${q.id}: ${what} says why, in why${q.type === "rank" ? " at the top of the spec" : ""}`);
  }
  return problems;
}

/** Every picture in the spec, in page order, so the page build can copy each once. */
export function pictures(spec) {
  return spec.questions.flatMap((each) => [...each.pictures, ...(each.compare ?? [])]);
}
