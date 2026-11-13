// An ask page's answers: checked against the spec they answer, written as
// Markdown for the agent and the record, and turned into rows of the
// decisions and open-questions logs.

import { addDecision } from "../logs/decisions.mjs";
import { addQuestion } from "../logs/questions.mjs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { answersPath, askDir } from "../view/serve.mjs";
import { DECIDE } from "./spec.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const NOTE = 5000;
const PINS = 50;

// The page's own rules for what an answer is and when a follow-up shows,
// loaded from the file the page runs, so the page and the record agree.
const S = (() => {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(new URL("./browser/state.js", import.meta.url), "utf8"), sandbox);
  return sandbox.window.wfAskState;
})();
const byIdOf = (spec) => new Map(spec.questions.map((each) => [each.id, each]));
/** The questions a page asks with these answers: every one, less follow-ups whose earlier answer does not fit. */
export const asked = (spec, answers) => {
  const byId = byIdOf(spec);
  return spec.questions.filter((q) => S.shown(q, answers ?? {}, byId));
};
const isMap = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

/**
 * The answers kept to what the spec asks, or `{ problems }`. A field the spec
 * does not ask for is dropped; a value it could not hold is a problem.
 */
export function checkAnswers(spec, raw, kinds) {
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problems: ["answers are a JSON object"] };
  if (raw.id !== spec.id) problems.push(`these answers are for ${raw.id}, not ${spec.id}`);
  if (raw.hash !== spec.hash) problems.push(`these answers are for an older page of ${spec.id} (${raw.hash}); the page now is ${spec.hash}`);
  const given = raw.answers && typeof raw.answers === "object" ? raw.answers : {};
  const answers = {};
  const byId = byIdOf(spec);
  for (const [id, value] of Object.entries(given)) {
    const q = byId.get(id);
    if (!q) {
      problems.push(`${id} is not a question on this page`);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const ids = q.options.map((each) => each.id);
    const out = {};
    if (value.choice != null && value.choice !== "") {
      const picks = q.type === "many" ? (Array.isArray(value.choice) ? value.choice : [value.choice]) : [value.choice];
      const known = picks.every((each) => ids.includes(each) || (q.other && each === "other"));
      if (!known || (q.type !== "one" && q.type !== "many")) problems.push(`${id}: ${JSON.stringify(value.choice)} is not one of its options`);
      else out.choice = q.type === "many" ? [...new Set(picks)] : picks[0];
    }
    if (value.order != null) {
      const order = Array.isArray(value.order) ? value.order : [];
      if (q.type !== "rank" || order.length !== ids.length || [...order].sort().join() !== [...ids].sort().join()) problems.push(`${id}: the order is every item once`);
      else out.order = order;
    }
    for (const field of ["text", "other", "note"]) {
      if (value[field] == null || value[field] === "") continue;
      if (typeof value[field] !== "string" || value[field].length > NOTE) problems.push(`${id}: ${field} is text of at most ${NOTE} characters`);
      else out[field] = value[field];
    }
    if (value.decide != null && value.decide !== "") {
      if (!DECIDE.includes(value.decide) || !q.defer) problems.push(`${id}: decide is ${q.defer ? DECIDE.join(" or ") : "not offered here"}`);
      else out.decide = value.decide;
    }
    if (value.number != null) {
      const sc = q.scale;
      const n = value.number;
      const onStep = sc && Math.abs((n - sc.min) / sc.step - Math.round((n - sc.min) / sc.step)) < 1e-9;
      if (!sc || typeof n !== "number" || !Number.isFinite(n) || n < sc.min || n > sc.max || !onStep) problems.push(`${id}: ${sc ? `the number is from ${sc.min} to ${sc.max}, by ${sc.step}` : "takes no number"}`);
      else out.number = n;
    }
    if (value.rows != null) {
      const rows = q.rows.map((each) => each.id);
      if (!isMap(value.rows) || (q.type !== "grid" && q.type !== "buckets") || !Object.entries(value.rows).every(([k, v]) => rows.includes(k) && ids.includes(v))) problems.push(`${id}: rows place each of its rows on one of its options`);
      else if (Object.keys(value.rows).length) out.rows = { ...value.rows };
    }
    if (value.edits != null) {
      const edits = q.edits.map((each) => each.id);
      if (!isMap(value.edits) || q.type !== "edits" || !Object.entries(value.edits).every(([k, v]) => edits.includes(k) && (v === "accept" || v === "reject"))) problems.push(`${id}: edits accept or reject each of its edits`);
      else if (Object.keys(value.edits).length) out.edits = { ...value.edits };
    }
    if (value.fields != null) {
      const fields = new Map(q.fields.map((f) => [f.id, f]));
      if (!isMap(value.fields) || q.type !== "form") problems.push(`${id}: ${q.type === "form" ? "fields are its fields' values" : "takes no fields"}`);
      else {
        const kept = {};
        for (const [k, v] of Object.entries(value.fields)) {
          const f = fields.get(k);
          // A required field still empty is only open; a value it cannot hold is wrong.
          const wrong = f && v != null && v !== "" && v !== false ? S.fieldProblem(f, v) : "";
          if (!f || wrong || (typeof v === "string" && v.length > NOTE)) problems.push(`${id}: field ${k}${f ? `: ${wrong || "too long"}` : " is not one of its fields"}`);
          else if (v != null && v !== "" && v !== false) kept[k] = v;
        }
        if (Object.keys(kept).length) out.fields = kept;
      }
    }
    if (value.owner != null && value.owner !== "") {
      if (!q.owners.includes(value.owner)) problems.push(`${id}: owner is ${q.owners.length ? `one of ${q.owners.join(", ")}` : "not offered here"}`);
      else out.owner = value.owner;
    }
    if (value.pins != null) {
      const pins = Array.isArray(value.pins) ? value.pins : [];
      const count = q.pictures.length + (q.compare ? 2 : 0);
      if (!q.pins || pins.length > PINS) problems.push(`${id}: ${q.pins ? `at most ${PINS} pins` : "takes no pins"}`);
      else {
        out.pins = [];
        for (const pin of pins) {
          const ok = pin && Number.isInteger(pin.picture) && pin.picture >= 0 && pin.picture < count && Number.isFinite(pin.x) && Number.isFinite(pin.y) && kinds[pin.kind] && typeof (pin.text ?? "") === "string" && (pin.text ?? "").length <= NOTE;
          // A region is a pin with a width and a height: a box drawn on the picture.
          const region = pin?.w != null || pin?.h != null;
          const regionOk = !region || (Number.isFinite(pin.w) && Number.isFinite(pin.h) && pin.w > 0 && pin.h > 0 && !spec.off?.includes("regions"));
          if (!ok || !regionOk) problems.push(`${id}: a pin has a picture, x, y, one of the kinds, and text${region ? (spec.off?.includes("regions") ? "; boxes are turned off here" : ", and a box a width and a height above 0") : ""}`);
          else out.pins.push({ picture: pin.picture, x: Math.round(pin.x), y: Math.round(pin.y), ...(region ? { w: Math.round(pin.w), h: Math.round(pin.h) } : {}), kind: pin.kind, text: pin.text ?? "", ...(Number.isInteger(pin.box) ? { box: pin.box } : {}) });
        }
      }
    }
    if (Object.keys(out).length) answers[id] = out;
  }
  if (problems.length) return { problems };
  // A follow-up the answers do not ask is not answered: what it held goes.
  const live = asked(spec, answers);
  for (const id of Object.keys(answers)) if (!live.some((q) => q.id === id)) delete answers[id];
  const open = live.filter((each) => !answered(answers[each.id], each)).map((each) => each.id);
  return { answers: { id: spec.id, hash: spec.hash, submitted: typeof raw.submitted === "string" && ISO.test(raw.submitted) && !Number.isNaN(Date.parse(raw.submitted)) ? raw.submitted : new Date().toISOString(), partial: open.length > 0, open, answers } };
}

/**
 * How far a page is answered: `waiting` (nothing sent since it was built),
 * `partial`, or `answered`, with the count still open and the answers. The
 * one rule for it: answers count only when sent after the page was built,
 * since building it is asking again, and only for the page as it is now.
 */
export function askState(view, id, spec) {
  const file = answersPath(view, id);
  const built = statSync(join(askDir(view, id), "spec.json")).mtimeMs;
  if (!existsSync(file) || statSync(file).mtimeMs <= built) return { state: "waiting", open: asked(spec, {}).length, answers: null };
  let answers;
  try {
    answers = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { state: "waiting", open: asked(spec, {}).length, answers: null };
  }
  if (answers?.hash !== spec.hash) return { state: "waiting", open: asked(spec, {}).length, answers: null };
  const open = asked(spec, answers.answers).filter((q) => !answered(answers.answers?.[q.id], q)).length;
  return { state: open ? "partial" : "answered", open, answers };
}

/** Whether a question has an answer, by the page's own rule (lib/ask/browser/state.js). */
export function answered(value, q) {
  return S.answered(value, q);
}

const labelOf = (q, id) => (id === "other" ? "other" : q.options.find((each) => each.id === id)?.label ?? id);
const clip = (value) => String(value).replace(/\s+/g, " ").trim();

/** One question's answer in a line, such as `**b** Tabs (recommended)`, or `you decide`. */
export function answerLine(q, value) {
  if (!answered(value, q)) {
    const placed = Object.keys(value?.rows ?? value?.edits ?? {}).length;
    return placed ? `${placed} of ${(q.rows.length ? q.rows : q.edits).length} done, so still open` : value?.fields ? "the form is not finished" : "no answer";
  }
  if (value.decide === "agent") return "you decide";
  if (value.decide === "later") return "later";
  const rec = Array.isArray(q.recommended) ? q.recommended : q.recommended ? [q.recommended] : [];
  if (value.order) return `order: ${value.order.map((id) => labelOf(q, id)).join(" → ")}`;
  if (value.number != null) return `**${value.number}**${q.scale?.unit ? ` ${q.scale.unit}` : ""}${q.recommended === value.number ? " (recommended)" : ""}`;
  if (value.rows) return q.type === "buckets" ? q.options.map((o) => `${o.label}: ${q.rows.filter((r) => value.rows[r.id] === o.id).map((r) => r.label).join(", ") || "none"}`).join("; ") : "every row answered, below";
  if (value.edits) {
    const n = (what) => Object.values(value.edits).filter((each) => each === what).length;
    return `${n("accept")} accepted, ${n("reject")} rejected`;
  }
  if (value.fields) return "the form, below";
  if (value.choice != null) {
    const picks = Array.isArray(value.choice) ? value.choice : [value.choice];
    const said = picks.map((id) => `**${id}** ${labelOf(q, id)}${rec.includes(id) ? " (recommended)" : ""}`).join(", ");
    return value.other ? `${said}: “${clip(value.other)}”` : said;
  }
  if (value.other) return `other: “${clip(value.other)}”`;
  return `“${clip(value.text)}”`;
}

/** The answers as Markdown: a heading, then a bullet per question with its note and pins. */
export function answersMarkdown(spec, record) {
  const answers = record?.answers ?? {};
  const open = asked(spec, answers).filter((each) => !answered(answers[each.id], each));
  const when = record?.submitted ? `, answered ${clip(String(record.submitted).replace("T", " ").slice(0, 16))}` : ", not answered yet";
  const lines = [`# ${spec.title} (${spec.id})${when}${open.length && record ? `, ${open.length} of ${asked(spec, answers).length} open` : ""}`, ""];
  let group = null;
  const live = new Set(asked(spec, answers).map((q) => q.id));
  for (const q of spec.questions) {
    const heading = q.table || q.group;
    if (heading && heading !== group) {
      if (lines.at(-1) !== "") lines.push("");
      lines.push(`## ${heading}`, "");
      group = heading;
    }
    const value = answers[q.id];
    if (!live.has(q.id)) {
      lines.push(`- **${q.id}** ${clip(q.text)}: not asked, as it follows ${q.showIf.question}.`);
      continue;
    }
    lines.push(`- **${q.id}** ${clip(q.text)}: ${answerLine(q, value)}.`);
    if (value?.owner) lines.push(`  - Owner: ${clip(value.owner)}`);
    if (value?.rows && q.type === "grid") for (const r of q.rows) lines.push(`  - ${clip(r.label)}: ${value.rows[r.id] ? labelOf(q, value.rows[r.id]) : "no answer"}`);
    if (value?.edits) for (const e of q.edits) lines.push(`  - Edit **${e.id}**${e.label ? ` ${clip(e.label)}` : ""}: ${value.edits[e.id] === "accept" ? "accepted" : value.edits[e.id] === "reject" ? "rejected" : "no answer"}`);
    if (value?.fields) for (const f of q.fields) lines.push(`  - ${clip(f.label)}: ${value.fields[f.id] == null ? "empty" : f.kind === "check" ? (value.fields[f.id] ? "yes" : "no") : f.kind === "select" ? labelOf({ options: f.options }, value.fields[f.id]) : clip(value.fields[f.id])}`);
    if (value?.text && value.choice != null) lines.push(`  - Text: ${clip(value.text)}`);
    if (value?.note) lines.push(`  - Note: ${clip(value.note)}`);
    const pictures = [...q.pictures, ...(q.compare ?? [])];
    for (const [i, pin] of (value?.pins ?? []).entries()) {
      const pic = pictures[pin.picture];
      const where = pic?.label || pic?.name || `picture ${pin.picture + 1}`;
      const at = pin.w ? `a box at ${pin.x}, ${pin.y}, ${pin.w}×${pin.h}` : `${pin.x}, ${pin.y}`;
      lines.push(`  - ${pin.w ? "Box" : "Pin"} ${i + 1} on ${where} at ${at} (${pin.kind})${pin.box != null ? `, in box ${pin.box}` : ""}: ${clip(pin.text) || "no text"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Write the answers into the logs: each "later" as an open question, and each
 * answered question with `record` as a decision in that file. Resolves with
 * one line per row written or refused, so one bad row does not stop the rest.
 */
export function recordAnswers(root, config, spec, record, date) {
  const lines = [];
  const answers = record?.answers ?? {};
  for (const q of spec.questions) {
    const value = answers[q.id];
    if (!value) continue;
    try {
      if (value.decide === "later") {
        const id = addQuestion(root, config, { chunk: q.chunk || spec.chunk || "none", question: clip(q.text), needs: q.role || "owner", from: spec.from || "developer", date, revisit: q.chunk || spec.chunk ? "" : `the next ask about ${spec.id}` });
        lines.push(`${q.id}: open question ${id}`);
      } else if (q.record && value.choice != null) {
        const picks = Array.isArray(value.choice) ? value.choice : [value.choice];
        const decision = `${clip(q.text)} ${picks.map((id) => labelOf(q, id)).join(", ")}${value.other ? `: ${clip(value.other)}` : ""}`;
        const why = clip(value.note || picks.map((id) => q.options.find((each) => each.id === id)?.why).filter(Boolean).join("; ") || `chosen on the ask page ${spec.id}`);
        lines.push(`${q.id}: ${addDecision(root, config, q.record, decision, why, date)}`);
      }
    } catch (err) {
      lines.push(`${q.id}: not recorded: ${err.message}`);
    }
  }
  return lines;
}
