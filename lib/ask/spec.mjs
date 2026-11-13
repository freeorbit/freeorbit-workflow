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
// `recommended` and `why`, and in rank, `why` for the suggested order (the
// order the items are listed in). When there is honestly nothing to
// recommend, `noPick` says why instead, and the page shows it. The review
// templates' verdicts are the person's own, so they recommend nothing.

import { createHash } from "node:crypto";

/** The templates: what each is for, how its page is laid out, and the field that holds its items. */
export const TEMPLATES = {
  decision: { layout: "list", items: "questions", use: "Pick one of several plans or answers, each with a preview, a recommendation, and why." },
  compare: { layout: "pages", items: "pairs", use: "A frame against the app, or before against after: side by side, swipe, onion skin, or difference, with a verdict per pair." },
  "frame-review": { layout: "pages", items: "frames", use: "Each frame marked fine, bug, drift, or look here, with pins on the picture." },
  storyboard: { layout: "pages", items: "steps", use: "A flow's screens in order; each step passes or breaks." },
  batch: { layout: "groups", items: "questions", use: "A chunk's questions at once, grouped by the role that owns each." },
  triage: { layout: "list", items: "items", use: "Answer, defer, or drop each open question." },
  rank: { layout: "list", items: "items", use: "Put items in order, such as priorities or build order." },
  naming: { layout: "list", items: "items", use: "Pick or write a label or a line of text, on the screen it sits on." },
  testdata: { layout: "table", items: "tables", use: "Rule tables from the test-data check: each row fine, a gap, or wrong." },
  plan: { layout: "list", items: "steps", use: "Approve each step of a plan or ask for a change, then the plan as a whole." },
  signoff: { layout: "list", items: "checks", use: "Tick each check, or object to it with a reason." },
};

export const TYPES = ["one", "many", "text", "rank"];
export const DECIDE = ["agent", "later"];
/** The templates whose choices carry a recommendation. */
export const ADVISED = ["decision", "batch", "naming", "triage", "rank"];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_QUESTIONS = 300;

const VERDICTS = {
  compare: [
    { id: "match", label: "Matches", kind: "ok" },
    { id: "drift", label: "Drifts from the frame", kind: "drift" },
    { id: "bug", label: "A bug", kind: "bug" },
    { id: "better", label: "Different, and the app is right", kind: "new" },
  ],
  "frame-review": [
    { id: "ok", label: "Fine", kind: "ok" },
    { id: "bug", label: "Bug", kind: "bug" },
    { id: "drift", label: "Drift", kind: "drift" },
    { id: "look", label: "Look again", kind: "look" },
  ],
  storyboard: [
    { id: "ok", label: "This step works", kind: "ok" },
    { id: "breaks", label: "This step breaks", kind: "bug" },
  ],
  triage: [
    { id: "answer", label: "Answer it now (write the answer in the note)" },
    { id: "defer", label: "Keep it open for later" },
    { id: "drop", label: "Drop it: no longer a question" },
  ],
  testdata: [
    { id: "ok", label: "Fine", kind: "ok" },
    { id: "gap", label: "A gap", kind: "drift" },
    { id: "wrong", label: "Wrong", kind: "bug" },
  ],
  plan: [
    { id: "approve", label: "Approve", kind: "ok" },
    { id: "change", label: "Change it (say how in the note)", kind: "drift" },
  ],
  signoff: [
    { id: "done", label: "Done", kind: "ok" },
    { id: "object", label: "Object (say why in the note)", kind: "bug" },
  ],
};

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

/** The template's items as plain decision-style entries, before checking. */
function expand(spec, problems) {
  const template = spec.template;
  const items = list(spec[TEMPLATES[template].items]);
  const verdicts = (raw) => (spec.verdicts ? spec.verdicts : VERDICTS[template]);
  const id = (each, i, prefix) => each?.id ?? `${prefix}${i + 1}`;
  switch (template) {
    case "decision":
    case "batch":
      if (template === "batch") items.forEach((each, i) => { if (!each?.role) problems.push(`questions ${i + 1}: a batch question names the role that owns it`); });
      return items.map((each) => ({ ...each, group: each?.group || (template === "batch" ? each?.role : "") }));
    case "compare":
      return items.map((each, i) => ({ id: id(each, i, "pair-"), text: each?.text || `${each?.label || `Pair ${i + 1}`}: do these match?`, type: "one", options: verdicts(), compare: [each?.left, each?.right], pins: true, look: each?.look, detail: each?.detail, role: each?.role }));
    case "frame-review":
      return items.map((each, i) => ({ id: id(each, i, "frame-"), text: each?.text || `${each?.name || `Frame ${i + 1}`}: how is it?`, type: "one", options: verdicts(), pictures: [{ ...each, label: each?.label ?? String(i + 1) }], pins: true, look: each?.look, group: each?.area, detail: each?.detail }));
    case "storyboard":
      return items.map((each, i) => ({ id: id(each, i, "step-"), text: `Step ${i + 1}: ${each?.caption || each?.name || ""}`.trim(), type: "one", options: verdicts(), pictures: each?.image ? [{ image: each.image, name: each.name, label: String(i + 1), boxes: each.boxes }] : [], pins: Boolean(each?.image), look: each?.look }));
    case "triage":
      return items.map((each, i) => ({ id: id(each, i, "item-"), text: `${each?.id ? `${each.id}: ` : ""}${each?.text || ""}`, detail: each?.context, type: "one", options: verdicts(), role: each?.needs || each?.role, chunk: each?.chunk, recommended: each?.recommended, why: each?.why, noPick: each?.noPick }));
    case "rank":
      return [{ id: spec.rankId || "order", text: spec.prompt || "Put these in order, first at the top.", type: "rank", options: items.map((each, i) => (typeof each === "string" ? { id: `item-${i + 1}`, label: each } : { id: id(each, i, "item-"), label: each?.label, why: each?.why })), why: spec.why, noPick: spec.noPick, defer: false }];
    case "naming":
      return items.map((each, i) => ({ id: id(each, i, "name-"), text: `${each?.where || `Label ${i + 1}`}: which words?`, detail: each?.current ? `Now: “${each.current}”` : "", type: "one", options: list(each?.options), recommended: each?.recommended, why: each?.why, noPick: each?.noPick, other: true, pictures: each?.picture ? [each.picture] : [], look: each?.look }));
    case "testdata":
      return items.flatMap((table, t) => list(table?.rows).map((row, r) => ({ id: `${table?.id ?? `table-${t + 1}`}.${row?.id ?? r + 1}`, text: row?.id ?? `Row ${r + 1}`, type: "one", options: verdicts(), cells: row?.cells, columns: table?.columns, table: table?.title || table?.id || `Table ${t + 1}`, defer: false })));
    case "plan":
      return [
        ...items.map((each, i) => ({ id: id(each, i, "step-"), text: `${i + 1}. ${typeof each === "string" ? each : each?.text || ""}`, detail: each?.detail, type: "one", options: verdicts(), defer: false })),
        { id: "plan", text: spec.prompt || "The plan as a whole", type: "one", options: [{ id: "go", label: "Go ahead", kind: "ok" }, { id: "redo", label: "Rework it first", kind: "drift" }], recommended: "go", defer: false },
      ];
    case "signoff":
      return items.map((each, i) => ({ id: id(each, i, "check-"), text: typeof each === "string" ? each : each?.text || "", detail: each?.detail, type: "one", options: verdicts(), defer: false }));
    default:
      return [];
  }
}

/** The spec checked and expanded: `{ spec, problems }`. The spec carries `hash`, which answers name. */
export function normalize(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { spec: null, problems: ["a spec is a JSON object"] };
  const template = raw.template ?? "decision";
  if (!ID.test(text(raw.id))) problems.push(`id "${text(raw.id)}" is lowercase letters, digits, and dashes, at most 64`);
  if (!raw.title) problems.push("a spec has a title");
  if (!TEMPLATES[template]) return { spec: null, problems: [...problems, `template is one of ${Object.keys(TEMPLATES).join(", ")}, not ${template}`] };
  const field = TEMPLATES[template].items;
  if (!Array.isArray(raw[field]) || !raw[field].length) problems.push(`a ${template} spec lists its ${field}`);
  const questions = expand({ ...raw, template }, problems)
    .map((each, i) => question(each, `${field} ${i + 1}`, problems))
    .filter(Boolean);
  if (questions.length > MAX_QUESTIONS) problems.push(`${questions.length} questions; a page holds at most ${MAX_QUESTIONS}, so split it`);
  const ids = questions.map((each) => each.id);
  const twice = ids.filter((each, i) => ids.indexOf(each) !== i);
  if (twice.length) problems.push(`question ids repeat: ${[...new Set(twice)].join(", ")}`);
  for (const each of questions) if (each.record && each.type !== "one" && each.type !== "many") problems.push(`${each.id}: only a one or many question records a decision`);
  if (ADVISED.includes(template)) problems.push(...adviceProblems(questions));
  const spec = {
    id: text(raw.id),
    title: text(raw.title),
    template,
    layout: TEMPLATES[template].layout,
    intro: text(raw.intro),
    from: text(raw.from),
    chunk: text(raw.chunk),
    questions,
  };
  spec.hash = createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 12);
  return { spec, problems };
}

/** A choice with no recommendation and why, or a noPick with one, by the asking rules. */
function adviceProblems(questions) {
  const problems = [];
  for (const q of questions) {
    if (q.type === "text") continue;
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
