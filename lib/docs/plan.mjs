// Reads an area's plan doc: the work before and around its stories that is
// not a story, in the shape writing-docs.md#plan-docs gives:
//
//   ## Phase 1. Understand the documents
//
//   Learn what the documents hold before deciding what to build.
//
//   | ID | Step | Who | Status | Leaves behind | Unblocks |
//   | --- | --- | --- | --- | --- | --- |
//   | W-ANL-07 | 1.7 Get four sets of documents | Glen, developer | Waiting on Glen: asked 2026-11-20 | A contract for records | ANL-03 |
//
// Only `## Phase N. Title` sections are read; any other `##` section is the
// team's. The board shows a phase's title and lead, and a step's text, Who,
// and Status, so those hold nothing internal: no ID, link, backtick, or path.
// Pure: it knows no file system.

import { cellsOf, isSeparator } from "./table.mjs";
import { phaseId, prefixesOf, stepIdPattern, storyPattern } from "../ids.mjs";
import { projectStories } from "./stories.mjs";

/** The status words a step's Status starts with, each with its key in board.workStatuses. */
export const STATUS_WORDS = { Done: "done", Now: "now", Next: "next", Later: "later", Waiting: "waiting" };
const REQUIRED = ["ID", "Step", "Who", "Status"];
const OPTIONAL = ["Leaves behind", "Unblocks"];

const PHASE = /^## Phase (\d+)\. (\S.*)$/;
// Something with the look of an ID: D-ANL-001, Q-027, CH-12, SEC-083, ANL-03, MIN-RAS-0057.
const ID_LIKE = /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+[a-z]?(?![A-Za-z0-9_-])/;
const CODE_FILE = /\b[\w-]+\.(?:md|mjs|cjs|js|ts|tsx|jsx|json|py|rs|toml|ya?ml|sh|html|css|sql)\b/;
const FOLDER = /(?:^|\s)\.{0,2}\/?[\w.-]+\/[\w.-]+\/|(?:^|\s)\.{0,2}\/[\w.-]+/;

/**
 * Why a text the client reads on the board is refused, or null: an ID, a link,
 * a backtick, or a file path is the team's, never the client's. A story ID is
 * told apart, since a step that names one is likely that story's work.
 */
export const leakOf = (text, prefixes = []) => leakWith(text, storyPattern(prefixes, ""));

/** leakOf with the story ID pattern built once by the caller. */
function leakWith(text, storyId) {
  const s = String(text ?? "");
  if (s.includes("`")) return "holds a backtick; code names stay off the board";
  if (/\[[^\]]*\]\([^)]*\)|https?:\/\//.test(s)) return "holds a link";
  if (CODE_FILE.test(s) || FOLDER.test(s)) return "holds a file path";
  const story = s.match(storyId);
  if (story) return `names story ${story[0]}; a step that builds a story belongs to the build order, and one it unblocks goes under Unblocks`;
  const id = s.match(ID_LIKE);
  if (id) return `holds ${id[0]}; IDs are the team's, so say it in words`;
  return null;
}

/** A Status cell taken apart: { word, key, waitsOn, note } or { problem }. `note` is the whole cell when it says more than its word, else "". */
export function readStatus(cell) {
  const match = String(cell ?? "").match(/^(\w+)(.*)$/);
  const word = match?.[1];
  if (!word || !(word in STATUS_WORDS)) return { problem: `starts "${String(cell ?? "").split(/[\s,:]/)[0]}", not one of ${Object.keys(STATUS_WORDS).join(", ")}` };
  const rest = match[2];
  if (word === "Waiting") {
    const on = rest.match(/^ on ([^,:]+?)\s*(?:[,:]\s*\S.*)?$/);
    return on ? { word, key: STATUS_WORDS[word], waitsOn: on[1], note: String(cell) } : { problem: 'is "Waiting on <name>", then a comma or colon and any more' };
  }
  if (rest && !/^[,:]\s*\S/.test(rest)) return { problem: `has "${rest.trim()}" after ${word}; a comma or colon goes first` };
  return { word, key: STATUS_WORDS[word], waitsOn: null, note: rest ? String(cell) : "" };
}

/** A phase's status from its steps' keys: done when all are, else waiting, now, or next when any is, else later. */
export function phaseStatus(keys) {
  if (keys.length && keys.every((key) => key === "done")) return "done";
  return ["waiting", "now", "next"].find((key) => keys.includes(key)) ?? "later";
}

/**
 * The phases of one plan doc and every problem in its shape, as
 * { phases, problems }. Each phase is { id, number, title, lead, line, steps },
 * and each step { id, name, who, status, note, key, waitsOn, unblocks, line }. `prefix` is the area's story prefix, `prefixes` every area's, and
 * `stories` the live stories' IDs, the ones Unblocks may name.
 */
export function readPlan(text, { path = "", prefix, prefixes = [], stories = new Set() } = {}) {
  const lines = String(text ?? "")
    .replace(/^```[\s\S]*?^```$/gm, (block) => block.replace(/[^\n]/g, ""))
    .split("\n");
  const problems = [];
  const at = (line, why) => problems.push(`${path}:${line}: ${why}`);
  const phases = [];
  const ids = new Map();
  const storyId = storyPattern(prefixes, "");
  const leak = (value) => leakWith(value, storyId);
  let current = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("## ")) {
      i += 1;
      continue;
    }
    const heading = line.match(PHASE);
    if (!heading) {
      if (/^## Phase\b/i.test(line)) at(i + 1, `"${line}" is not "## Phase N. Title"`);
      i += 1;
      continue;
    }
    const number = Number(heading[1]);
    current = { id: phaseId(prefix, number), number, title: `Phase ${number}. ${heading[2].trim()}`, lead: "", line: i + 1, steps: [] };
    phases.push(current);
    if (number !== phases.length) at(i + 1, `Phase ${number} comes after ${phases.length - 1 ? `Phase ${phases[phases.length - 2].number}` : "no phase"}; number the phases 1, 2, 3, in order, a new one last`);
    const why = leak(heading[2]);
    if (why) at(i + 1, `the phase's title ${why}`);
    // The lead: the text between the heading and the table, one paragraph of one sentence.
    i += 1;
    const lead = [];
    while (i < lines.length && !lines[i].startsWith("|") && !lines[i].startsWith("## ")) lead.push(lines[i++]);
    const paragraphs = lead.join("\n").trim().split(/\n\s*\n/).filter((part) => part.trim());
    current.lead = (paragraphs[0] ?? "").replace(/\s+/g, " ").trim();
    if (!current.lead) at(current.line, "the phase has no lead: one sentence under its heading, before its table");
    else if (paragraphs.length > 1) at(current.line, "the phase's lead is more than one paragraph before its table");
    else if (/[.!?]\s+[A-Z]/.test(current.lead)) at(current.line, "the phase's lead is more than one sentence");
    const leadWhy = current.lead && leak(current.lead);
    if (leadWhy) at(current.line, `the phase's lead ${leadWhy}`);
    if (!lines[i]?.startsWith("|")) {
      at(current.line, "the phase has no table of steps");
      continue;
    }
    i = readTable(lines, i, current, { at, prefix, storyId, leak, stories, ids });
  }
  return { phases, problems };
}

/** One phase's step table from line `i`, its rows into the phase; returns the line after it. */
function readTable(lines, i, phase, { at, prefix, storyId, leak, stories, ids }) {
  const header = cellsOf(lines[i]);
  const tableLine = i + 1;
  if (header[0] !== "ID") at(tableLine, `the steps table's first column is "${header[0]}", not ID`);
  for (const name of REQUIRED.filter((each) => !header.includes(each))) at(tableLine, `the steps table has no ${name} column`);
  for (const name of header.filter((each) => !REQUIRED.includes(each) && !OPTIONAL.includes(each))) at(tableLine, `the steps table's column "${name}" is not one a step has (${[...REQUIRED, ...OPTIONAL].join(", ")})`);
  i += 1;
  if (isSeparator(lines[i] ?? "")) i += 1;
  const stepPattern = stepIdPattern(prefix);
  const numbers = new Set();
  for (; i < lines.length && lines[i].startsWith("|"); i += 1) {
    const cells = cellsOf(lines[i]);
    const get = (name) => (header.includes(name) ? (cells[header.indexOf(name)] ?? "").trim() : "");
    const line = i + 1;
    const id = get("ID");
    if (!header.includes("ID")) {
      // The table's missing ID column is its one problem, not each row's.
    } else if (!stepPattern.test(id)) at(line, `"${id}" is not a step ID such as W-${prefix}-01`);
    else if (ids.has(id)) at(line, `${id} is also the ID of the step on line ${ids.get(id)}; an ID is never reused`);
    else ids.set(id, line);
    const step = get("Step").match(/^(\d+)\.(\d+)\s+(\S.*)$/);
    if (!step) at(line, `${id}'s Step "${get("Step")}" is not "${phase.number}.<n> <what is done>"`);
    else if (Number(step[1]) !== phase.number) at(line, `${id}'s Step ${step[1]}.${step[2]} is not numbered under Phase ${phase.number}`);
    else if (numbers.has(step[2])) at(line, `${id}'s Step ${step[1]}.${step[2]} has the number of another step`);
    if (step) numbers.add(step[2]);
    const who = get("Who");
    if (!who) at(line, `${id} has no Who`);
    const status = readStatus(get("Status"));
    if (status.problem) at(line, `${id}'s Status ${status.problem}`);
    for (const [field, value] of [["Step", step?.[3] ?? ""], ["Who", who], ["Status", get("Status")]]) {
      const why = leak(value);
      if (why) at(line, `${id}'s ${field} ${why}`);
    }
    const unblocks = get("Unblocks");
    const named = unblocks && unblocks !== "none" ? unblocks.split(/,\s*/) : [];
    for (const each of named) {
      if (!storyId.test(each) || each.match(storyId)[0] !== each) at(line, `${id}'s Unblocks "${each}" is not a story ID; list them comma-separated, or none`);
      else if (!stories.has(each)) at(line, `${id}'s Unblocks names ${each}, which is not a live story in the story files`);
    }
    phase.steps.push({ id, name: get("Step"), who, status: get("Status"), note: status.note ?? "", key: status.key ?? null, waitsOn: status.waitsOn ?? null, unblocks: named, line });
  }
  if (!phase.steps.length) at(tableLine, "the phase's table has no steps");
  return i;
}

/**
 * Each plan doc board.workItems.plans lists, read, as { plans: [{ areaId,
 * path, read }], problems }: a doc not in the repo, each doc's shape, and a
 * step ID two docs both use. A listed area unknown to the config is the
 * config's problem (board/settings.mjs), and is skipped here. doc:check and
 * the board share it.
 */
export function readPlanDocs(context) {
  const { config, tracked, files } = context;
  const plans = [];
  const problems = [];
  const listed = Object.entries(config.board?.workItems?.plans ?? {});
  if (!listed.length) return { plans, problems };
  const live = new Set(projectStories(context).filter((story) => !story.removed).map((story) => story.id));
  const prefixes = prefixesOf(config);
  const seen = new Map();
  for (const [areaId, path] of listed) {
    const area = config.areas.find((each) => each.id === areaId);
    if (!area?.prefix || typeof path !== "string") continue;
    if (!tracked.includes(path)) {
      problems.push(`${path}: board.workItems.plans names it as ${areaId}'s plan doc, and it is not in the repo`);
      continue;
    }
    const read = readPlan(files(path), { path, prefix: area.prefix, prefixes, stories: live });
    problems.push(...read.problems);
    for (const step of read.phases.flatMap((phase) => phase.steps)) {
      if (seen.has(step.id) && seen.get(step.id) !== path) problems.push(`${path}:${step.line}: ${step.id} is also a step in ${seen.get(step.id)}; an ID is unique across the app`);
      seen.set(step.id, path);
    }
    plans.push({ areaId, area, path, read });
  }
  return { plans, problems };
}
