// Every field a spec may carry, by place, so a misspelt one is named and
// never silently dropped.

import { list } from "./blocks.mjs";
import { TEMPLATES } from "./templates.mjs";

export const SPEC_FIELDS = ["$schema", "id", "title", "template", "intro", "chunk", "from", "live", "steps", "off", "on", "sections", "blocks", "verdicts", "prompt", "rankId", "why", "noPick", "recommended", "modifiers", "more"];
export const QUESTION_FIELDS = ["id", "text", "type", "options", "recommended", "why", "noPick", "role", "group", "look", "detail", "chunk", "pictures", "compare", "pins", "other", "defer", "record", "explain", "showIf", "owners", "scale", "rows", "items", "edits", "fields", "cells", "columns", "table", "more"];
export const OPTION_FIELDS = ["id", "label", "why", "preview", "kind", "glyph"];
export const PICTURE_FIELDS = ["image", "label", "name", "boxes"];
export const ITEM_FIELDS = {
  compare: ["id", "text", "label", "left", "right", "look", "detail", "role", "more"],
  "frame-review": ["id", "text", "name", "label", "image", "boxes", "look", "area", "detail", "more"],
  storyboard: ["id", "caption", "name", "image", "boxes", "look", "more"],
  triage: ["id", "text", "context", "needs", "role", "chunk", "recommended", "why", "noPick", "more"],
  rank: ["id", "label", "why"],
  naming: ["id", "where", "current", "options", "recommended", "why", "noPick", "picture", "look", "more"],
  testdata: ["id", "title", "columns", "rows"],
  plan: ["id", "text", "detail", "more"],
  signoff: ["id", "text", "detail", "more"],
  launch: ["id", "label", "why", "command", "time", "cost", "details"],
};
export const ROW_FIELDS = ["id", "cells", "recommended", "why"];

/** How many single-letter changes turn one word into another. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return row[b.length];
}

/** A problem for each field of `raw` that is not in `allowed`, with the nearest name when one is close. */
export function unknown(raw, allowed, where, problems) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const key of Object.keys(raw)) {
    if (allowed.includes(key)) continue;
    const near = allowed.map((name) => [distance(key.toLowerCase(), name.toLowerCase()), name]).sort((a, b) => a[0] - b[0])[0];
    problems.push(`${where}: no field ${key}${near && near[0] <= 2 ? `; did you mean ${near[1]}?` : ""}`);
  }
}

/**
 * Fields the kit does not know: on the spec, on each item of a kit template,
 * and on a written question's options and pictures. A project's own template
 * names its items' fields itself, so its items are not checked.
 */
export function unknownFields(raw, template, def, problems) {
  unknown(raw, [...SPEC_FIELDS, def.items], "the spec", problems);
  if (!TEMPLATES[template]) return;
  const named = (each, i) => `${def.items} ${i + 1}${each && typeof each === "object" && each.id ? ` (${each.id})` : ""}`;
  for (const [i, each] of list(raw[def.items]).entries()) {
    const where = named(each, i);
    unknown(each, def.asWritten ? QUESTION_FIELDS : ITEM_FIELDS[template], where, problems);
    if (template === "testdata") for (const [r, row] of list(each?.rows).entries()) unknown(row, ROW_FIELDS, `${where} row ${r + 1}`, problems);
    if (!def.asWritten && template !== "naming") continue;
    for (const [o, opt] of list(each?.options).entries()) unknown(opt, OPTION_FIELDS, `${where} option ${o + 1}`, problems);
    for (const [n, pic] of [...list(each?.pictures), ...list(each?.compare), ...(each?.picture ? [each.picture] : [])].entries()) unknown(pic, PICTURE_FIELDS, `${where} picture ${n + 1}`, problems);
  }
  for (const [o, opt] of list(raw.verdicts).entries()) unknown(opt, OPTION_FIELDS, `verdicts ${o + 1}`, problems);
}
