// Asking the agent for more, on a page still open: the person asks for more
// on one question, or on the page, or proposes an option; the agent, woken
// by `wf ask wait`, answers in place with blocks (Markdown with code, a
// diff, a table, a code block) and options it adds to the question. The
// page draws each reply under its question, and the person's answers stay.
//
//   .cache/view/ask/<id>/asks.json   { <question id | _page>: [{ n, kind, text, at }] }   the server writes it
//   .cache/view/ask/<id>/more.json   { replies: { <question id | _page>: [{ to, blocks, options, at }] },
//                                      told: { <question id | _page>: n } }                 the agent writes it
//
// Each side writes its own file, so the server and the CLI never write over
// each other. A reply answers every ask before it (`to`, the last ask's n);
// `told` is how far `wf ask wait` has told the agent, so an ask wakes it once.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeWhole } from "../files.mjs";
import { liveBlocks, list, str } from "./blocks.mjs";
import { RULES } from "./rules.mjs";
import { askDir } from "./store.mjs";

/** Where an ask about the whole page is kept, as the page reads it (lib/ask/browser/state.js). */
export const PAGE = RULES.PAGE;
export const KINDS = ["more", "option"];
export const MORE_LIMITS = { ask: 1000, pending: 5, asks: 30, replies: 20, options: 10, text: 4000 };
const QID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const asksFile = (view, id) => join(askDir(view, id), "asks.json");
export const moreFile = (view, id) => join(askDir(view, id), "more.json");

// The files as last parsed, by path, with the stamp they had: the server's
// poll and wait's loop read them often, and parse them again only when they
// change. Each is written whole, by a rename, so a new write is a new inode.
const parsed = new Map();
/** A JSON object file, or `fallback`. Read `fresh` to change and write it: the kept copy is shared. */
const readJson = (file, fallback, { fresh = false } = {}) => {
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st) { parsed.delete(file); return fallback; }
  const stamp = `${st.mtimeMs}:${st.ino}:${st.size}`;
  const kept = parsed.get(file);
  if (!fresh && kept?.stamp === stamp) {
    parsed.delete(file);
    parsed.set(file, kept);
    return kept.value;
  }
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  if (!fresh) {
    // At most a few hundred files kept; the least read go first.
    parsed.delete(file);
    parsed.set(file, { stamp, value });
    if (parsed.size > 500) parsed.delete(parsed.keys().next().value);
  }
  return value;
};

/** The person's asks, by question (PAGE for the page). */
export const readAsks = (view, id, opts) => readJson(asksFile(view, id), {}, opts);
/** The agent's replies and how far wait has told it, by question. */
export function readMore(view, id, opts) {
  const more = readJson(moreFile(view, id), {}, opts);
  const map = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  return { replies: map(more.replies), told: map(more.told) };
}
/** What the page reads: the asks and the replies. */
export function moreOf(view, id) {
  const { replies, told } = readMore(view, id);
  return { asks: readAsks(view, id), replies, told };
}

const off = (spec) => spec.off?.includes("more");
const questionOf = (spec, question) => (question === PAGE ? null : spec.questions.find((q) => q.id === question));
const named = (spec, question) => {
  if (question !== PAGE && !questionOf(spec, question)) throw new Error(`${question} is not a question on the page ${spec.id}`);
};

/**
 * Keep the person's ask for more on a question, or the page: `kind` "more"
 * (explain, an example, the code) or "option" (an option they propose, on
 * a one or many question). At most MORE_LIMITS.pending wait on one question.
 */
export function addAsk(view, spec, { question, kind = "more", text } = {}) {
  if (off(spec)) throw new Error(`asking for more is turned off on the page ${spec.id}`);
  const where = str(question);
  named(spec, where);
  if (!KINDS.includes(kind)) throw new Error(`kind is more or option, not ${str(kind)}`);
  const q = questionOf(spec, where);
  if (kind === "option" && !(q && (q.type === "one" || q.type === "many"))) throw new Error("an option is proposed on a one or many question");
  const said = str(text).trim();
  if (!said) throw new Error("an ask says what would help");
  if (said.length > MORE_LIMITS.ask) throw new Error(`an ask is at most ${MORE_LIMITS.ask} characters`);
  const asks = readAsks(view, spec.id, { fresh: true });
  const mine = list(asks[where]);
  const waiting = RULES.waitingAsks(mine, list(readMore(view, spec.id).replies[where])).length;
  if (waiting >= MORE_LIMITS.pending) throw new Error(`${where === PAGE ? "the page" : where} already waits on ${waiting} asks; wait for the agent's reply`);
  const n = (mine.at(-1)?.n ?? 0) + 1;
  asks[where] = [...mine, { n, kind, text: said, at: new Date().toISOString() }].slice(-MORE_LIMITS.asks);
  writeWhole(asksFile(view, spec.id), `${JSON.stringify(asks, null, 2)}\n`);
  return { n };
}

/** Every ask no reply has answered yet, in page order: `{ question, n, kind, text, at }`. */
export function pendingAsks(view, spec) {
  const asks = readAsks(view, spec.id);
  const { replies } = readMore(view, spec.id);
  const order = [PAGE, ...spec.questions.map((q) => q.id)];
  return order.flatMap((question) => RULES.waitingAsks(list(asks[question]), list(replies[question])).map((a) => ({ question, ...a })));
}

/** The asks wait has not told the agent of yet. */
export function untoldAsks(view, spec) {
  const { told } = readMore(view, spec.id);
  return pendingAsks(view, spec).filter((a) => a.n > (Number(told[a.question]) || 0));
}

/** Mark asks as told, so wait wakes the agent for each once. */
export function markTold(view, spec, asks) {
  const more = readMore(view, spec.id, { fresh: true });
  for (const a of asks) more.told[a.question] = Math.max(Number(more.told[a.question]) || 0, a.n);
  writeMore(view, spec.id, more);
}

function writeMore(view, id, more) {
  writeWhole(moreFile(view, id), `${JSON.stringify(more, null, 2)}\n`);
}

/**
 * Blocks for a reply, checked like a live page's: `md` (Markdown, as a text
 * block) first, then `blocks`. Gives `{ blocks, problems }`.
 */
export function moreBlocks({ md = null, blocks = null } = {}, ctx = {}) {
  const problems = [];
  const raw = [];
  if (md != null) {
    const text = str(md);
    if (text.length > MORE_LIMITS.text) problems.push(`Markdown is at most ${MORE_LIMITS.text} characters; split it into blocks`);
    else if (text.trim()) raw.push({ type: "text", text });
  }
  if (blocks != null) raw.push(...(Array.isArray(blocks) ? blocks : list(blocks?.blocks)));
  // A picture is copied into the page when it is built, so a reply shows none.
  if (raw.some((b) => b?.type === "pictures")) problems.push("more holds no pictures block; build the page again with the picture");
  const checked = problems.length ? [] : liveBlocks(raw, problems, { off: ctx.off ?? new Set(), parts: ctx.parts ?? {}, source: ctx.source ?? (() => null), file: ctx.file }, { where: "more block", what: "more" });
  return { blocks: problems.length ? [] : checked, problems };
}

/** An option the agent adds: an id no option of the question has, a label, and why. */
function addedOption(raw, q, taken) {
  if (!raw || typeof raw !== "object" || !QID.test(str(raw.id))) throw new Error("an option has an id of letters, digits, dots, dashes, or underscores");
  if (taken.has(raw.id) || raw.id === "other") throw new Error(`${q.id} has an option ${raw.id} already`);
  const label = str(raw.label || raw.id);
  if (label.length > 60 || str(raw.why).length > 200) throw new Error("an added option's label is at most 60 characters, and its why 200");
  taken.add(raw.id);
  return { id: raw.id, label, why: str(raw.why) };
}

/**
 * The agent's reply under a question, or the page: checked blocks, and
 * options to add to a one or many question. It answers every ask before it.
 * Gives `{ to, count }`: the last ask it answers, and the replies there now.
 */
export function addMore(view, spec, question, { blocks = [], options = [] } = {}) {
  if (off(spec)) throw new Error(`asking for more is turned off on the page ${spec.id}`);
  const where = str(question);
  named(spec, where);
  if (!list(blocks).length && !list(options).length) throw new Error("a reply shows something: Markdown, blocks, or an option");
  const q = questionOf(spec, where);
  const more = readMore(view, spec.id, { fresh: true });
  const before = list(more.replies[where]);
  let added = [];
  if (list(options).length) {
    if (!q || (q.type !== "one" && q.type !== "many")) throw new Error("options are added to a one or many question");
    // Counted from the replies, so a spec that already holds the added options counts them once.
    const earlier = before.flatMap((r) => list(r.options).map((o) => o.id));
    if (earlier.length + options.length > MORE_LIMITS.options) throw new Error(`a question takes at most ${MORE_LIMITS.options} added options`);
    const taken = new Set([...q.options.map((o) => o.id), ...earlier]);
    added = options.map((o) => addedOption(o, q, taken));
  }
  // A reply answers the asks wait told the agent of; one that came after waits for its own reply.
  // With none told (the agent read them some other way, or wrote unasked), it answers every ask so far.
  const told = Number(more.told[where]) || 0;
  const to = told || (list(readAsks(view, spec.id)[where]).at(-1)?.n ?? 0);
  // The oldest replies go past the limit, but never one that adds an option: those stay pickable.
  const all = [...before, { to, blocks: list(blocks), options: added, at: new Date().toISOString() }];
  const keep = all.filter((r, i) => list(r.options).length || i >= all.length - MORE_LIMITS.replies);
  more.replies[where] = keep;
  writeMore(view, spec.id, more);
  return { to, count: keep.length };
}

/** When the agent last replied with more on the page, in ms, or 0: a reply asks again. */
export function moreAt(view, id) {
  const { replies } = readMore(view, id);
  const times = Object.values(replies).flatMap((r) => list(r).map((each) => Date.parse(each?.at))).filter(Number.isFinite);
  // The reply's own time, not the file's: marking asks as told writes the file and asks nothing.
  // A time is kept to the millisecond, so the end of its millisecond: answers sent in it came before.
  return times.length ? Math.max(...times) + 1 : 0;
}

/** The spec with the options the agent added since it was built, as its own; the hash is the same page's. */
export function withMore(view, spec) {
  return withOptions(spec, readMore(view, spec.id).replies);
}

/** The spec with the options the agent's replies added, from replies already read, such as a team server's. */
export function withOptions(spec, replies = {}) {
  if (!Object.keys(replies).length) return spec;
  return {
    ...spec,
    questions: spec.questions.map((q) => {
      const added = list(replies[q.id]).flatMap((r) => list(r.options));
      if (!added.length || (q.type !== "one" && q.type !== "many")) return q;
      const known = new Set(q.options.map((o) => o.id));
      return { ...q, options: [...q.options, ...added.filter((o) => !known.has(o.id)).map(RULES.addedOption)] };
    }),
  };
}

/** The asks as lines for the agent: `- q1 (Pick q1?): “Show the code”`, a proposed option said as one. */
export function askLines(spec, asks) {
  return asks.map((a) => {
    const q = questionOf(spec, a.question);
    const where = q ? `${q.id} (${str(q.text).replace(/\s+/g, " ").slice(0, 80)})` : "the page";
    return `- ${where}: ${a.kind === "option" ? "proposes an option: " : ""}“${str(a.text).replace(/\s+/g, " ")}”`;
  });
}
