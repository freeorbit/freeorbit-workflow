// `wf ask fields <part>`: one template's, question type's, or block's fields
// and limits, so an agent reads a few lines in place of the whole skill. The
// names come from the lists the spec check uses (lib/ask/spec.mjs), so a
// field printed here is one the check takes; the tests hold the rest to the
// examples.

import { BLOCK_KINDS, BLOCK_LIMITS, FEATURES, RICH_TYPES } from "./blocks.mjs";
import { LIMITS } from "./advice.mjs";
import { ITEM_FIELDS, OPTION_FIELDS, PICTURE_FIELDS, QUESTION_FIELDS, ROW_FIELDS, SPEC_FIELDS } from "./fieldnames.mjs";
import { ANSWER_LIMITS, TYPES } from "./questions.mjs";
import { TEMPLATES } from "./templates.mjs";

/** What a question type adds to a question, and what its answer holds. */
export const TYPE_FIELDS = {
  one: { fields: ["options", "recommended", "why", "noPick", "other"], answer: "choice: one option id", note: "Each option says what it means in why, in the advised templates." },
  many: { fields: ["options", "recommended", "why", "noPick", "other"], answer: "choice: a list of option ids", note: "recommended is a list." },
  text: { fields: [], answer: "text", note: "A question with no options is a text question." },
  rank: { fields: ["options", "why"], answer: "order: the option ids, first at the top", note: "The options are listed in the suggested order; why says why." },
  scale: { fields: ["scale", "recommended", "why"], answer: "number", note: "scale: min (1), max (5), step (1), style (stars, slider, number), low, high, unit." },
  grid: { fields: ["rows", "options", "recommended", "why"], answer: "rows: { row: option }", note: "rows of id, label, why; the options are the columns; recommended is { row: option }." },
  buckets: { fields: ["items", "options", "recommended", "why"], answer: "rows: { item: bucket }", note: "items of id, label, why; the options are the buckets; recommended is { item: bucket }." },
  edits: { fields: ["edits", "recommended", "why"], answer: "edits: { edit: accept | reject }", note: "edits of id, label, before, after, by (word or line), why; recommended is \"accept\" or { edit: \"accept\" }." },
  form: { fields: ["fields"], answer: "fields: { field: value }", note: "fields of id, label, kind (text, long, number, check, select, date), required, min, max, options, help, placeholder." },
};

/** Each block's own fields; every block also takes title and note. */
export const BLOCK_FIELDS = {
  text: ["text"],
  code: ["file", "lines", "mark", "code", "lang", "start"],
  stats: ["items"],
  table: ["columns", "rows", "source", "filter", "sort"],
  diff: ["before", "after", "by", "view", "labels"],
  chart: ["kind", "labels", "series", "stacked", "unit"],
  diagram: ["nodes", "links", "direction"],
  timeline: ["events"],
  board: ["columns", "cards"],
  pictures: ["items"],
  questions: ["group", "ids"],
  part: ["name", "with"],
};
const BLOCK_NOTES = {
  text: "Headings (#), paragraphs, lists, **bold**, *italic*, `code`, fenced code (```js, or ```js:120 to number from line 120); no links or HTML.",
  code: "file (a path in the project, read when the page is built; never .git or a file that may hold secrets) with lines [first, last], or code inline with lang and start; mark lists lines to mark, or [first, last] pairs. At most 400 lines.",
  stats: "items of label, value, tone (ok, warn, bad, info), note, trend (numbers, drawn as a sparkline).",
  table: "columns and rows, or source: open-questions, decisions (with filter, a file id), or ledger.",
  diff: "by is line or word; view is side or inline; labels names the two sides.",
  chart: "kind is bar or line; series of name and values, a number or null for each label.",
  diagram: "nodes of id, label, note, tone; links of from, to, label; direction right or down.",
  timeline: "events of date, title, note, state (done, now, next).",
  board: "columns (ids, or id and title); cards of title, column, note, tone, owner, tags.",
  pictures: "items of image (a path from the project root), label, name; up to 12, side by side, each opens full size. Copied into the page like a question's pictures.",
  questions: "Where the questions go: one group's, the ones ids names, or with neither every one left.",
  part: "A part in .workflow/ask-parts/<name>.json, filled from with.",
};

const limits = (map, names) => names.filter((n) => map[n] != null).map((n) => `${n} ${map[n]}`).join(", ");

/** The lines `wf ask fields <part>` prints, or null when the kit has no such part. */
export function fieldsOf(part) {
  if (TEMPLATES[part]) {
    const def = TEMPLATES[part];
    const out = [`${part}: a template (${def.layout}). ${def.use}`, `The spec: ${[...SPEC_FIELDS.filter((f) => f !== "$schema"), def.items].join(", ")}`];
    if (def.asWritten) out.push(`Each of ${def.items} is a question: ${QUESTION_FIELDS.join(", ")}`, `An option: ${OPTION_FIELDS.join(", ")}`, `A picture: ${PICTURE_FIELDS.join(", ")}; a box: n, kind, rect [x, y, width, height], text`);
    else out.push(`Each of ${def.items}: ${ITEM_FIELDS[part].join(", ")}${part === "rank" || part === "plan" || part === "signoff" ? ", or plain text" : ""}`);
    if (part === "testdata") out.push(`A row: ${ROW_FIELDS.join(", ")}`);
    if (part === "naming") out.push(`An option: ${OPTION_FIELDS.join(", ")}`, `picture: ${PICTURE_FIELDS.join(", ")}`);
    if (part === "compare") out.push(`left and right are pictures: ${PICTURE_FIELDS.join(", ")}`);
    if (def.verdicts) out.push(`Verdicts: ${def.verdicts.map((v) => v.id).join(", ")}; verdicts in the spec replaces them, each of ${OPTION_FIELDS.join(", ")}`);
    out.push(def.advised ? "Advised: every option says what it means in why, and each choice names recommended and says why, or says in noPick why not." : "Its verdicts are the person's own, so it needs no recommendation.");
    out.push(`Limits, in characters: ${limits(LIMITS, ["text", "label", "why", "optionWhy", "detail", "look"])}`, `Example: npx wf ask example ${part}`);
    return out;
  }
  if (TYPE_FIELDS[part] && TYPES.includes(part)) {
    const t = TYPE_FIELDS[part];
    return [`${part}: a question type${RICH_TYPES.includes(part) ? ", one of the richer ones" : ""}.`, `Beside id, text, and type: ${t.fields.join(", ") || "nothing"}`, t.note, `The answer: ${t.answer}`, `Every question also takes: ${QUESTION_FIELDS.filter((f) => !["id", "text", "type", ...Object.values(TYPE_FIELDS).flatMap((x) => x.fields), "cells", "columns", "table"].includes(f)).join(", ")}`, `Limits: ${limits(ANSWER_LIMITS, ["rows", "edits", "fields", "owners"])}`];
  }
  if (BLOCK_FIELDS[part] && BLOCK_KINDS.includes(part)) {
    return [`${part}: a block, in a section's blocks or the spec's.`, `Fields: type, ${["title", "note", ...BLOCK_FIELDS[part]].join(", ")}`, BLOCK_NOTES[part], `Limits: ${limits(BLOCK_LIMITS, ["blocks", "rows", "columns", "cell", "text", "title", "note", "stat", "diff", "points", "series", "nodes", "events", "cards"])}`];
  }
  return null;
}

/** Every part `fields` knows, for its usage line. */
export const fieldParts = () => ({ templates: Object.keys(TEMPLATES), types: TYPES, blocks: BLOCK_KINDS, off: FEATURES });
