// An ask page's spec: what `wf ask page` reads. A spec names a template and
// its items, and each template expands into plain questions, so the page,
// the answers, and the record read one shape.
//
//   { "id": "chunk-38c2-start", "title": "Chunk 38c2", "template": "decision",
//     "questions": [{ "id": "layout", "text": "Which layout?", "type": "one",
//                     "options": [{ "id": "a", "label": "Tabs", "why": "…" }, …],
//                     "recommended": "a", "why": "…" }] }
//
// A question's type is one (pick one), many (pick any), text, or rank. Any
// question may carry pictures, a compare pair, pins, a role, a group, a
// "look" line saying where to look, and "record", the decisions file its
// answer goes to. The examples are in plugins/core/skills/ask-page/examples.
//
// A question that asks for a choice recommends one and says why, as the
// asking rules say: in the decision, batch, naming, and triage templates,
// `recommended` and `why`, with a `why` on every option saying what it
// means, and in rank, `why` for the suggested order (the
// order the items are listed in). When there is honestly nothing to
// recommend, `noPick` says why instead, and the page shows it. The review
// templates' verdicts are the person's own, so they recommend nothing.

import { createHash } from "node:crypto";

export const TYPES = ["one", "many", "text", "rank"];
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
  };
  if (!QID.test(out.id)) problems.push(`${where}: id "${out.id}" is letters, digits, dots, dashes, or underscores, at most 64`);
  if (!out.text) problems.push(`${where}: ${out.id || "a question"} has no text`);
  if (!TYPES.includes(type)) problems.push(`${where}: type is one of ${TYPES.join(", ")}, not ${type}`);
  out.options = list(raw.options).map((each, i) => option(each, `${where} option ${i + 1}`, problems)).filter(Boolean);
  if (["one", "many", "rank"].includes(type) && out.options.length < 2) problems.push(`${where}: a ${type} question has at least two options`);
  const ids = out.options.map((each) => each.id);
  if (new Set(ids).size !== ids.length) problems.push(`${where}: option ids repeat`);
  const rec = out.recommended;
  if (rec != null) {
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

/** The spec checked and expanded: `{ spec, problems }`. The spec carries `hash`, which answers name. `custom` is the project's templates by name. */
export function normalize(raw, custom = {}) {
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
  if (def.advised) problems.push(...adviceProblems(questions));
  problems.push(...lengthProblems(questions));
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
  }
  return problems;
}

/** A choice with no recommendation and why, or a noPick with one, by the asking rules. */
function adviceProblems(questions) {
  const problems = [];
  for (const q of questions) {
    if (q.type === "text") continue;
    // Each option says what it means, so the ones not recommended are understood too.
    const bare = q.options.filter((each) => !each.why).map((each) => each.id);
    if (bare.length) problems.push(`${q.id}: every option says what it means, in why; ${bare.join(", ")} ${bare.length === 1 ? "does" : "do"} not`);
    const what = q.type === "rank" ? "a suggested order" : "a recommendation";
    if (q.noPick) {
      if (q.recommended != null) problems.push(`${q.id}: noPick says there is no recommendation, but it recommends ${JSON.stringify(q.recommended)}`);
      continue;
    }
    if (q.type !== "rank" && q.recommended == null) problems.push(`${q.id}: ${what}: name the option in recommended, or say in noPick why there is none`);
    if (!q.why) problems.push(`${q.id}: ${what} says why, in why${q.type === "rank" ? " at the top of the spec" : ""}`);
  }
  return problems;
}

/** Every picture in the spec, in page order, so the page build can copy each once. */
export function pictures(spec) {
  return spec.questions.flatMap((each) => [...each.pictures, ...(each.compare ?? [])]);
}
