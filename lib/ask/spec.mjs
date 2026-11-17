// An ask page's spec: what `wf ask page` reads. The templates are in
// templates.mjs, a question's checks in questions.mjs, the field names in
// fieldnames.mjs, and the advice in advice.mjs. A spec names a template and
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
// templates' verdicts are the person's own, so they recommend nothing; the
// one exception is a testdata page from `wf testdata review`, whose rows the
// designer already wrote, so each is recommended Fine and accepted in bulk.

import { createHash } from "node:crypto";

import { adviceProblems, groupingAdvice, lengthProblems, templateAdvice } from "./advice.mjs";
import { FEATURES, list, offFor, placeQuestions, sectionsOf, str } from "./blocks.mjs";
import { unknownFields } from "./fieldnames.mjs";
import { followUpProblems, question } from "./questions.mjs";
import { ID } from "./store.mjs";
import { expandProject, launchData, TEMPLATES } from "./templates.mjs";

const MAX_QUESTIONS = 300;

/** A page's hash: its shape, and the bytes of its pictures when it has any. Answers name it. */
export function pageHash(shape, digests = []) {
  return createHash("sha256").update(JSON.stringify(shape)).update(digests.join()).digest("hex").slice(0, 12);
}

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
  if (!ID.test(str(raw.id))) problems.push(`id "${str(raw.id)}" is lowercase letters, digits, and dashes, at most 64`);
  if (!raw.title) problems.push("a spec has a title");
  const def = TEMPLATES[template] ?? custom[template];
  if (!def) return { spec: null, problems: [...problems, `template is one of ${[...Object.keys(TEMPLATES), ...Object.keys(custom)].join(", ")}, not ${template}`] };
  const field = def.items;
  unknownFields(raw, template, def, problems);
  if (raw[field] != null && !Array.isArray(raw[field])) problems.push(`a ${template} spec's ${field} is a list`);
  else if (!def.optional && !raw[field]?.length) problems.push(`a ${template} spec lists its ${field}`);
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
  if (sections) placeQuestions(sections, questions, problems);
  // A step-by-step page shows one section at a time, each a step.
  const steps = raw.steps === true;
  if (steps && !sections) problems.push("a step-by-step page gives its steps as sections");
  if (steps && def.layout !== "list") problems.push(`a ${template} page shows ${def.layout === "pages" ? "one frame" : "its rows"} at a time already; steps need a list layout`);
  // A live page shows what the agent says while a step runs (npx wf ask live); a status page always is one.
  const live = (template === "status" || raw.live === true) && !off.has("live");
  const spec = {
    id: str(raw.id),
    title: str(raw.title),
    template,
    layout: def.layout,
    intro: str(raw.intro),
    from: str(raw.from),
    chunk: str(raw.chunk),
    questions,
  };
  if (sections) spec.sections = sections;
  if (steps) spec.steps = true;
  if (live) spec.live = true;
  if (template === "launch") spec.launch = launchData(raw, problems, { off, parts: ctx.parts ?? {}, source: ctx.source ?? (() => null) });
  else if (raw.modifiers != null) problems.push("modifiers belong to a launch page");
  const features = [...off].filter((name) => FEATURES.includes(name));
  if (features.length) spec.off = features;
  spec.hash = pageHash(spec);
  return { spec, problems, advice: [...groupingAdvice(spec).map((line) => `Grouping: ${line}`), ...templateAdvice(spec).map((line) => `Template: ${line}`)] };
}
