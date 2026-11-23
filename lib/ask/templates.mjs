// The kit's ask-page templates, a launch page's runs and options, and a
// project's own templates kept as data: each expands its items into plain
// questions, so the page, the answers, and the record read one shape.

import { list, liveBlocks, str } from "./blocks.mjs";
import { unknown } from "./fieldnames.mjs";
import { TYPES } from "./questions.mjs";

const nth = (each, i, prefix) => each?.id ?? `${prefix}${i + 1}`;

/**
 * Every kit template, each in one record: what it is for (`use`), how its
 * page is laid out, the spec's field that lists its items, its verdicts when
 * it has its own, whether its choices carry a recommendation (`advised`),
 * and how its items expand into plain questions. `expand` gets the items,
 * the verdicts to use (the spec's own, or the template's), the spec, and the
 * problems list. `asWritten` marks a template whose questions are written
 * out one by one, not made from its items. Adding a template is adding a
 * record and its example.
 */
export const TEMPLATES = {
  decision: {
    layout: "list", items: "questions", advised: true, asWritten: true,
    use: "Pick one of several plans or answers, each with a preview, a recommendation, and why.",
    expand: (items) => items.map((each) => ({ ...each, group: each?.group || "" })),
  },
  status: {
    layout: "list", items: "questions", advised: true, optional: true, asWritten: true,
    use: "Where a step stands while it runs: blocks the agent updates with npx wf ask live, a progress line, and the log; questions are optional.",
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
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "pair-"), text: each?.text || `${each?.label || `Pair ${i + 1}`}: do these match?`, type: "one", options: verdicts, compare: [each?.left, each?.right], pins: true, look: each?.look, detail: each?.detail, role: each?.role, more: each?.more })),
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
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "frame-"), text: each?.text || `${each?.name || `Frame ${i + 1}`}: how is it?`, type: "one", options: verdicts, pictures: [{ ...each, label: each?.label ?? String(i + 1) }], pins: true, look: each?.look, group: each?.area, detail: each?.detail, more: each?.more })),
  },
  storyboard: {
    layout: "pages", items: "steps",
    use: "A flow's screens in order; each step passes or breaks.",
    verdicts: [
      { id: "ok", label: "This step works", kind: "ok" },
      { id: "breaks", label: "This step breaks", kind: "bug" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "step-"), text: each?.caption || each?.name || `Step ${i + 1}`, type: "one", options: verdicts, pictures: each?.image ? [{ image: each.image, name: each.name, label: String(i + 1), boxes: each.boxes }] : [], pins: Boolean(each?.image), look: each?.look, more: each?.more })),
  },
  batch: {
    layout: "groups", items: "questions", advised: true, asWritten: true,
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
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "item-"), text: `${each?.id ? `${each.id}: ` : ""}${each?.text || ""}`, detail: each?.context, type: "one", options: verdicts, role: each?.needs || each?.role, chunk: each?.chunk, recommended: each?.recommended, why: each?.why, noPick: each?.noPick, more: each?.more })),
  },
  rank: {
    layout: "list", items: "items", advised: true,
    use: "Put items in order, such as priorities or build order.",
    expand: (items, verdicts, spec) => [{ id: spec.rankId || "order", text: spec.prompt || "Put these in order, first at the top.", type: "rank", options: items.map((each, i) => (typeof each === "string" ? { id: `item-${i + 1}`, label: each } : { id: nth(each, i, "item-"), label: each?.label, why: each?.why })), why: spec.why, noPick: spec.noPick, defer: false }],
  },
  naming: {
    layout: "list", items: "items", advised: true,
    use: "Pick or write a label or a line of text, on the screen it sits on.",
    expand: (items) => items.map((each, i) => ({ id: nth(each, i, "name-"), text: `${each?.where || `Label ${i + 1}`}: which words?`, detail: each?.current ? `Now: “${each.current}”` : "", type: "one", options: list(each?.options), recommended: each?.recommended, why: each?.why, noPick: each?.noPick, other: true, pictures: each?.picture ? [each.picture] : [], look: each?.look, more: each?.more })),
  },
  testdata: {
    layout: "table", items: "tables",
    use: "Rule tables from the test-data check: each row fine, a gap, wrong, or not worth keeping.",
    verdicts: [
      { id: "ok", label: "Fine", kind: "ok" },
      { id: "gap", label: "A gap", kind: "drift" },
      { id: "wrong", label: "Wrong", kind: "bug" },
      // Drop: not worth testing at all; the note says why, and `wf testdata drop --from <id>` applies it.
      { id: "drop", label: "Drop", kind: "look", glyph: "✕" },
    ],
    // A row may carry its recommended verdict, so Take all recommendations accepts a table in one go.
    expand: (items, verdicts) => items.flatMap((table, t) => list(table?.rows).map((row, r) => ({ id: `${table?.id ?? `table-${t + 1}`}.${row?.id ?? r + 1}`, text: row?.id ?? `Row ${r + 1}`, type: "one", options: verdicts, cells: row?.cells, columns: table?.columns, table: table?.title || table?.id || `Table ${t + 1}`, recommended: row?.recommended, why: row?.why, defer: false }))),
  },
  plan: {
    layout: "list", items: "steps",
    use: "Approve each step of a plan or ask for a change, then the plan as a whole.",
    verdicts: [
      { id: "approve", label: "Approve", kind: "ok" },
      { id: "change", label: "Change it (say how in the note)", kind: "drift" },
    ],
    expand: (items, verdicts, spec) => [
      ...items.map((each, i) => ({ id: nth(each, i, "step-"), text: typeof each === "string" ? each : each?.text || "", detail: each?.detail, type: "one", options: verdicts, defer: false, more: each?.more })),
      { id: "plan", text: spec.prompt || "The plan as a whole", type: "one", options: [{ id: "go", label: "Go ahead", kind: "ok" }, { id: "redo", label: "Rework it first", kind: "drift" }], recommended: "go", defer: false },
    ],
  },
  launch: {
    layout: "list", items: "runs", advised: true,
    use: "Choose how to run a step: each run with what it covers, its time, and its command, and options that add to it; the answer is the command. npx wf choose writes one from the project's state.",
    expand: (items, verdicts, spec) => [
      {
        id: "run", text: spec.prompt || "Which run?", type: "one", group: "Run", defer: false,
        options: items.map((each, i) => ({ id: nth(each, i, "run-"), label: each?.label, why: [each?.why, each?.time, each?.cost].filter(Boolean).join(" · "), preview: each?.command ? `$ ${each.command}` : "" })),
        recommended: spec.recommended, why: spec.why, noPick: spec.noPick,
      },
      ...list(spec.modifiers).map((m) => modifierQuestion(m)),
    ],
  },
  signoff: {
    layout: "list", items: "checks",
    use: "Tick each check, or object to it with a reason.",
    verdicts: [
      { id: "done", label: "Done", kind: "ok" },
      { id: "object", label: "Object (say why in the note)", kind: "bug" },
    ],
    expand: (items, verdicts) => items.map((each, i) => ({ id: nth(each, i, "check-"), text: typeof each === "string" ? each : each?.text || "", detail: each?.detail, type: "one", options: verdicts, defer: false, more: each?.more })),
  },
};

/** The kinds of option a launch page adds to its run. */
export const MODIFIER_KINDS = ["toggle", "choice", "text"];
export const MODIFIER_FIELDS = ["id", "text", "kind", "runs", "flag", "options", "default", "recommended", "why", "detail", "on", "off"];

/** One launch option as a question: a toggle is Yes or No, a choice its options, text a line; each shows only for the runs it names. */
function modifierQuestion(m) {
  const base = { id: m?.id, text: m?.text, detail: m?.detail, group: "Options", defer: false, why: m?.why, showIf: list(m?.runs).length ? { question: "run", is: list(m.runs) } : undefined };
  if (m?.kind === "text") return { ...base, type: "text", why: undefined };
  if (m?.kind === "toggle") {
    return { ...base, type: "one", recommended: m.default ? "on" : "off", options: [{ id: "on", label: "Yes", why: m.on || `Adds ${m.flag}` }, { id: "off", label: "No", why: m.off || "Leaves it out" }] };
  }
  return { ...base, type: "one", recommended: m?.recommended, options: list(m?.options).map((o) => ({ id: o?.id, label: o?.label, why: [o?.why, o?.flag ? `adds ${o.flag}` : ""].filter(Boolean).join("; ") })) };
}

/**
 * What a launch page's command is made of: each run's command, and each
 * option's flags, `{ runs: { id: command }, modifiers: [{ id, kind, flag,
 * flags }] }`. A text option's flag holds {value}, where the words typed go.
 */
export function launchData(raw, problems, ctx = null) {
  const runs = {};
  const details = {};
  for (const [i, run] of list(raw.runs).entries()) {
    if (!str(run?.command)) problems.push(`runs ${i + 1}: a run has the command it runs`);
    if (run?.details != null) {
      const blocks = ctx ? liveBlocks(run.details, problems, ctx, { where: `runs ${i + 1} details block`, what: "a run's details" }) : [];
      if (blocks.length) details[nth(run, i, "run-")] = blocks;
    }
    runs[nth(run, i, "run-")] = str(run?.command);
  }
  const modifiers = [];
  for (const [i, m] of list(raw.modifiers).entries()) {
    const where = `modifiers ${i + 1}${m?.id ? ` (${m.id})` : ""}`;
    unknown(m, MODIFIER_FIELDS, where, problems);
    if (!MODIFIER_KINDS.includes(m?.kind)) problems.push(`${where}: kind is ${MODIFIER_KINDS.join(", ")}`);
    if (m?.id === "run") problems.push(`${where}: run is the run's own question; give the option another id`);
    for (const id of list(m?.runs)) if (!(id in runs)) problems.push(`${where}: runs names ${id}, which is not a run`);
    if (m?.kind === "toggle" && !str(m.flag)) problems.push(`${where}: a toggle has the flag it adds`);
    if (m?.kind === "text" && !str(m.flag).includes("{value}")) problems.push(`${where}: a text option's flag says where the words go, as {value}`);
    if (m?.kind === "choice" && !list(m.options).length) problems.push(`${where}: a choice lists its options`);
    const flags = m?.kind === "toggle" ? { on: str(m.flag), off: "" } : Object.fromEntries(list(m?.options).map((o) => [str(o?.id), str(o?.flag)]));
    modifiers.push({ id: str(m?.id), kind: str(m?.kind), flag: str(m?.flag), flags });
  }
  return { runs, modifiers, ...(Object.keys(details).length ? { details } : {}) };
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
  if (!NAME.test(str(raw.name))) problems.push(`${file}: name is lowercase letters, digits, and dashes`);
  else if (TEMPLATES[raw.name]) problems.push(`${file}: ${raw.name} is a kit template; a project's has its own name`);
  if (!raw.use) problems.push(`${file}: use says in a sentence what the template is for`);
  if (!LAYOUTS.includes(raw.layout ?? "list")) problems.push(`${file}: layout is one of ${LAYOUTS.join(", ")}`);
  if (!/^[a-z][A-Za-z0-9]*$/.test(str(raw.items))) problems.push(`${file}: items names the spec's field that lists the items, such as "packages"`);
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
export function expandProject(def, spec) {
  const fill = (pattern, item, i) => String(pattern).replace(/\{(\w+)\}/g, (_, key) => (key === "n" ? String(i + 1) : str(item?.[key])));
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
      group: def.groupBy ? str(one[def.groupBy]) : one.group,
      cells: columns.map((key) => str(one[key])),
      columns,
      table: def.layout === "table" ? str(one.table || spec.title) : "",
    };
  });
}
