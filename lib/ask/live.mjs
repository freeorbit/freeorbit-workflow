// What an ask page says between builds: a live page's status while a step
// runs, the agent's replies under questions, every round of answers sent,
// and what changed since the page was last asked. Each is a file under the
// page's own folder or the history folder; the page reads them through the
// server, and the CLI writes them.
//
//   .cache/view/ask/<id>/live.json      { state, step, progress, log, blocks, at }
//   .cache/view/ask/<id>/replies.json   { <question id>: [{ text, at }] }
//   .cache/view/history/<id>/<at>-<n>.json  { at, hash, answers }, one per send
//   .cache/view/history/<id>/spec-<hash>.json   the page each round answered

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { answersMarkdown, repliesPath } from "./answers.mjs";
import { liveBlocks, list, str } from "./blocks.mjs";
import { askDir, ID, writeWhole } from "../view/serve.mjs";

export const LIVE_STATES = ["running", "waiting", "done", "failed"];
export const LIVE_LIMITS = { step: 200, line: 500, log: 200, reply: 2000, replies: 20, rounds: 50 };

export const liveFile = (view, id) => join(askDir(view, id), "live.json");
export const repliesFile = repliesPath;
const historyDir = (view, id) => join(view, "history", id);

const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
};

/** A live page's status now, or null. */
export const readLive = (view, id) => readJson(liveFile(view, id), null);
/** The agent's replies under the page's questions, by question id. */
export const readReplies = (view, id) => readJson(repliesFile(view, id), {});

/**
 * A live update laid over the status before it: `{ live, problems }`.
 * `change` may hold `state`, `step`, `progress` ([done, of]), `log` (lines to
 * add), `blocks` (in place of the ones before), and `clear` (start again).
 */
export function updateLive(before, change, ctx = {}) {
  const problems = [];
  const live = change.clear ? { state: "running", step: "", progress: null, log: [], blocks: [] } : { state: "running", step: "", progress: null, log: [], blocks: [], ...(before ?? {}) };
  if (change.state != null) {
    if (!LIVE_STATES.includes(change.state)) problems.push(`state is ${LIVE_STATES.join(", ")}, not ${change.state}`);
    else live.state = change.state;
  }
  if (change.step != null) {
    const step = str(change.step);
    if (step.length > LIVE_LIMITS.step) problems.push(`a step is at most ${LIVE_LIMITS.step} characters`);
    else live.step = step;
  }
  if (change.progress != null) {
    const [done, of] = list(change.progress).map(Number);
    if (!Number.isInteger(done) || !Number.isInteger(of) || of < 1 || done < 0 || done > of) problems.push("progress is done of a total, such as 3/8");
    else live.progress = [done, of];
  }
  for (const line of list(change.log).map(str)) live.log.push(line.length > LIVE_LIMITS.line ? `${line.slice(0, LIVE_LIMITS.line - 1)}…` : line);
  live.log = live.log.slice(-LIVE_LIMITS.log);
  if (change.blocks != null) {
    const blocks = liveBlocks(change.blocks, problems, { off: ctx.off ?? new Set(), parts: ctx.parts ?? {}, source: ctx.source ?? (() => null) });
    if (!problems.length) live.blocks = blocks;
  }
  live.at = new Date().toISOString();
  return { live, problems };
}

/** Write a live page's status. */
export function writeLive(view, id, live) {
  writeWhole(liveFile(view, id), `${JSON.stringify(live, null, 2)}\n`);
}

/** Add the agent's reply under a question; a reply asks again, so the page waits for a send after it. */
export function addReply(view, spec, questionId, text) {
  if (!spec.questions.some((q) => q.id === questionId)) throw new Error(`${questionId} is not a question on the page ${spec.id}`);
  const said = str(text).trim();
  if (!said) throw new Error("a reply says something");
  if (said.length > LIVE_LIMITS.reply) throw new Error(`a reply is at most ${LIVE_LIMITS.reply} characters`);
  const replies = readReplies(view, spec.id);
  replies[questionId] = [...list(replies[questionId]), { text: said, at: new Date().toISOString() }].slice(-LIVE_LIMITS.replies);
  writeWhole(repliesFile(view, spec.id), `${JSON.stringify(replies, null, 2)}\n`);
  return replies[questionId].length;
}

/** Keep a round of answers in the page's history, with the page it answered; the oldest go past LIVE_LIMITS.rounds. */
export function keepRound(view, spec, answers) {
  if (spec.off?.includes("history") || !ID.test(spec.id)) return;
  const dir = historyDir(view, spec.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const page = join(dir, `spec-${spec.hash}.json`);
  if (!existsSync(page)) writeWhole(page, `${JSON.stringify(spec)}\n`);
  const at = new Date().toISOString();
  // Named by the time, and a count when two sends fall in one millisecond, so none is written over.
  const stamp = at.replace(/[:.]/g, "-");
  let n = 0;
  while (existsSync(join(dir, `${stamp}-${String(n).padStart(3, "0")}.json`))) n++;
  const name = `${stamp}-${String(n).padStart(3, "0")}.json`;
  writeWhole(join(dir, name), `${JSON.stringify({ at, hash: spec.hash, answers })}\n`);
  const rounds = readdirSync(dir).filter((f) => !f.startsWith("spec-")).sort();
  for (const old of rounds.slice(0, Math.max(0, rounds.length - LIVE_LIMITS.rounds))) rmSync(join(dir, old));
  // A page no round names any more is dropped with its last round.
  const named = new Set(rounds.slice(-LIVE_LIMITS.rounds).map((f) => readJson(join(dir, f), {}).hash));
  for (const f of readdirSync(dir).filter((x) => x.startsWith("spec-"))) if (!named.has(f.slice(5, -5))) rmSync(join(dir, f));
}

/** Every round of a page's answers, newest first: `{ at, hash, answers, spec }`. */
export function rounds(view, id) {
  if (!ID.test(String(id))) return [];
  const dir = historyDir(view, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith("spec-")).sort().reverse().map((f) => {
    const round = readJson(join(dir, f), null);
    return round && { ...round, spec: readJson(join(dir, `spec-${round.hash}.json`), null) };
  }).filter((r) => r?.spec);
}

/** A page's rounds as Markdown, newest first, each the answers as the agent got them. */
export function historyMarkdown(view, id) {
  const all = rounds(view, id);
  if (!all.length) return `# ${id}: no answers kept yet\n`;
  return all.map((r, i) => `<!-- round ${all.length - i} of ${all.length}, sent ${r.at}${i && r.hash !== all[i - 1].hash ? ", an earlier page" : ""} -->\n${answersMarkdown(r.spec, r.answers)}`).join("\n");
}

/** Every ask with kept rounds: `{ id, rounds, last }`, newest first. */
export function everyAsk(view) {
  const dir = join(view, "history");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((id) => ID.test(id)).map((id) => {
    const all = rounds(view, id);
    return { id, title: all[0]?.spec?.title ?? id, rounds: all.length, last: all[0]?.at ?? "" };
  }).filter((a) => a.rounds).sort((a, b) => b.last.localeCompare(a.last));
}

const shapeOf = (q) => JSON.stringify({ text: q.text, type: q.type, detail: q.detail, options: q.options.map((o) => [o.id, o.label, o.why]), recommended: q.recommended, rows: q.rows, edits: q.edits.map((e) => [e.id, e.ops]), fields: q.fields, scale: q.scale, pictures: q.pictures.map((p) => [p.image, p.boxes]), compare: q.compare?.map((p) => p.image) });

/**
 * What changed from the page last asked to this one: questions added,
 * removed, and changed (and what about them), and whether its blocks did.
 * Null when nothing did, or there was no page before.
 */
export function changesSince(before, now, at) {
  if (!before || before.hash === now.hash) return null;
  const old = new Map(before.questions.map((q) => [q.id, q]));
  const added = now.questions.filter((q) => !old.has(q.id)).map((q) => q.id);
  const removed = before.questions.filter((q) => !now.questions.some((x) => x.id === q.id)).map((q) => ({ id: q.id, text: q.text }));
  const changed = [];
  for (const q of now.questions) {
    const was = old.get(q.id);
    if (!was || shapeOf(was) === shapeOf(q)) continue;
    const what = [];
    if (was.text !== q.text || was.detail !== q.detail) what.push("the question");
    if (JSON.stringify(was.options.map((o) => [o.id, o.label, o.why])) !== JSON.stringify(q.options.map((o) => [o.id, o.label, o.why])) || JSON.stringify([was.rows, was.fields, was.scale, was.edits.map((e) => e.ops)]) !== JSON.stringify([q.rows, q.fields, q.scale, q.edits.map((e) => e.ops)])) what.push("what it offers");
    if (JSON.stringify(was.recommended) !== JSON.stringify(q.recommended)) what.push("the recommendation");
    if (JSON.stringify([was.pictures.map((p) => [p.image, p.boxes]), was.compare?.map((p) => p.image)]) !== JSON.stringify([q.pictures.map((p) => [p.image, p.boxes]), q.compare?.map((p) => p.image)])) what.push("the pictures");
    if (was.type !== q.type) what.push("its type");
    changed.push({ id: q.id, what: what.length ? what : ["its details"] });
  }
  // Which questions a questions block places follows from the questions, which are counted above.
  const shown = (sections) => JSON.stringify((sections ?? []).map((s) => ({ ...s, blocks: s.blocks.map((b) => (b.type === "questions" ? { ...b, ids: null } : b)) })));
  const blocks = shown(before.sections) !== shown(now.sections);
  // Only the pictures' bytes changed: the same questions, new shots.
  const pictures = !added.length && !removed.length && !changed.length && !blocks;
  return { since: at, added, removed, changed, blocks, pictures };
}
