// An ask page's answers: checked against the spec they answer, written as
// Markdown for the agent and the record, and turned into rows of the
// decisions and open-questions logs.

import { addDecision } from "../logs/decisions.mjs";
import { addQuestion } from "../logs/questions.mjs";
import { DECIDE } from "./spec.mjs";

const NOTE = 5000;
const PINS = 50;

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
  const byId = new Map(spec.questions.map((each) => [each.id, each]));
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
    if (value.pins != null) {
      const pins = Array.isArray(value.pins) ? value.pins : [];
      const count = q.pictures.length + (q.compare ? 2 : 0);
      if (!q.pins || pins.length > PINS) problems.push(`${id}: ${q.pins ? `at most ${PINS} pins` : "takes no pins"}`);
      else {
        out.pins = [];
        for (const pin of pins) {
          const ok = pin && Number.isInteger(pin.picture) && pin.picture >= 0 && pin.picture < count && Number.isFinite(pin.x) && Number.isFinite(pin.y) && kinds[pin.kind] && typeof (pin.text ?? "") === "string" && (pin.text ?? "").length <= NOTE;
          if (!ok) problems.push(`${id}: a pin has a picture, x, y, one of the kinds, and text`);
          else out.pins.push({ picture: pin.picture, x: Math.round(pin.x), y: Math.round(pin.y), kind: pin.kind, text: pin.text ?? "", ...(Number.isInteger(pin.box) ? { box: pin.box } : {}) });
        }
      }
    }
    if (Object.keys(out).length) answers[id] = out;
  }
  if (problems.length) return { problems };
  const open = spec.questions.filter((each) => !answered(answers[each.id])).map((each) => each.id);
  return { answers: { id: spec.id, hash: spec.hash, submitted: typeof raw.submitted === "string" ? raw.submitted : new Date().toISOString(), partial: open.length > 0, open, answers } };
}

/** Whether a question has an answer: a choice, an order, text, or a decide. */
export function answered(value) {
  return Boolean(value && (value.choice != null || value.order || value.text || value.decide || value.other));
}

const labelOf = (q, id) => (id === "other" ? "other" : q.options.find((each) => each.id === id)?.label ?? id);
const clip = (value) => String(value).replace(/\s+/g, " ").trim();

/** One question's answer in a line, such as `**b** Tabs (recommended)`, or `you decide`. */
export function answerLine(q, value) {
  if (!answered(value)) return "no answer";
  if (value.decide === "agent") return "you decide";
  if (value.decide === "later") return "later";
  const rec = Array.isArray(q.recommended) ? q.recommended : q.recommended ? [q.recommended] : [];
  if (value.order) return `order: ${value.order.map((id) => labelOf(q, id)).join(" → ")}`;
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
  const open = spec.questions.filter((each) => !answered(answers[each.id]));
  const when = record?.submitted ? `, answered ${record.submitted.replace("T", " ").slice(0, 16)}` : ", not answered yet";
  const lines = [`# ${spec.title} (${spec.id})${when}${open.length && record ? `, ${open.length} of ${spec.questions.length} open` : ""}`, ""];
  let group = null;
  for (const q of spec.questions) {
    const heading = q.table || q.group;
    if (heading && heading !== group) {
      if (lines.at(-1) !== "") lines.push("");
      lines.push(`## ${heading}`, "");
      group = heading;
    }
    const value = answers[q.id];
    lines.push(`- **${q.id}** ${clip(q.text)}: ${answerLine(q, value)}.`);
    if (value?.text && value.choice != null) lines.push(`  - Text: ${clip(value.text)}`);
    if (value?.note) lines.push(`  - Note: ${clip(value.note)}`);
    const pictures = [...q.pictures, ...(q.compare ?? [])];
    for (const [i, pin] of (value?.pins ?? []).entries()) {
      const pic = pictures[pin.picture];
      const where = pic?.label || pic?.name || `picture ${pin.picture + 1}`;
      lines.push(`  - Pin ${i + 1} on ${where} at ${pin.x}, ${pin.y} (${pin.kind})${pin.box != null ? `, in box ${pin.box}` : ""}: ${clip(pin.text) || "no text"}`);
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
