// The open questions log and the resolved questions beside it. Under each
// chunk's heading, and under "Not tied to a chunk yet", one table:
//
//   | ID | Question | Needs | From | Story | Raised |
//   | Q-012 | Should risk names match the client's register? | owner | client (monday) | REV-03 | 2026-11-14 |
//
// with any detail in short bullets under the table, one per ID:
// `- **Q-012.** ...`. An ID is Q-NNN, one counter across both files, and is
// never reused. An answered question leaves the open file in the same pass:
// its answer goes in the decisions log, and its row moves to the resolved
// file with the date and the decision it led to. `wf question add` assigns the
// next ID, `wf question resolve` moves a row, and doc:check holds the rest.
//
// A question under "Not tied to a chunk yet" blocks nothing, so nothing would
// bring it back. Its detail can say when to: a `Revisit when: ...` line, on
// the `- **Q-NNN.**` bullet or a sub-bullet under it. doc:facts status lists
// each untied question with its trigger, and names those with none, for chunk
// start and the code review to judge.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findChunk, readBuildOrder } from "../docs/shape.mjs";
import { cell, words } from "../docs/table.mjs";

export const OPEN_HEADER = ["| ID | Question | Needs | From | Story | Raised |", "| --- | --- | --- | --- | --- | --- |"];
export const RESOLVED_HEADER = ["| ID | Question | Needs | From | Story | Raised | Resolved | Decision |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
export const UNTIED = "Not tied to a chunk yet";
export const ID = /^Q-\d{3}$/;

const OPEN_COLUMNS = ["id", "question", "needs", "from", "story", "raised"];
const RESOLVED_COLUMNS = [...OPEN_COLUMNS, "resolved", "decision"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DETAIL = /^- \*\*(Q-\d{3})\.\*\*/;
const TICKED = /^\s*[-*]\s+\[[xX]\]/;
const REVISIT = /(?:^|\s)Revisit when:\s*(.+)$/;

const base = (role) => role.split(":")[0];
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((each) => each.trim());

/**
 * The question rows in a text, each { id, question, needs, from, story, raised,
 * resolved?, decision?, heading, line, width }: rows of a table whose first
 * header cell is ID and whose first cell is not a separator. `width` is the
 * number of cells, so a row that lost one is caught.
 */
export function questionRows(text) {
  const rows = [];
  let heading = "";
  let inTable = false;
  String(text ?? "")
    .split("\n")
    .forEach((line, index) => {
      heading = line.match(/^## (.+)$/)?.[1] ?? heading;
      if (!line.startsWith("|")) {
        inTable = false;
        return;
      }
      const cells = cellsOf(line);
      if (cells[0] === "ID") inTable = cells[1] === "Question";
      else if (inTable && !/^:?-+:?$/.test(cells[0])) {
        const row = Object.fromEntries(RESOLVED_COLUMNS.map((name, i) => [name, cells[i] ?? ""]));
        rows.push({ ...row, heading, line: index + 1, width: cells.length });
      }
    });
  return rows;
}

/** Each top-level bullet in a text that is not a `- **Q-NNN.**` detail, with its line: an old-style question. */
export function looseBullets(text) {
  return String(text ?? "")
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((each) => /^[-*] /.test(each.text) && !DETAIL.test(each.text));
}

/** The next free ID, past every one in the texts. */
export function nextId(texts) {
  const numbers = texts.flatMap((text) => questionRows(text).filter((row) => ID.test(row.id)).map((row) => Number(row.id.slice(2))));
  return `Q-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

/** Whether `who` is a role from config.roles, with or without a specialty. */
const isRole = (config, who) => /^[a-z][a-z-]*(?::[a-z-]+)?$/.test(who) && config.roles.includes(base(who));

/** The Needs value of a question the client answers, on the board; it never blocks a merge. */
export const CLIENT = "client";

/** Whether `needs` names who answers: a role, or the client. */
const isNeeds = (config, needs) => needs === CLIENT || isRole(config, needs);

/** Whether `from` names who raised a question: a role, or `client (<channel>)`. */
const isFrom = (config, from) => isRole(config, from) || /^client \([^()]+\)$/.test(from);

/** The problems in one cell set, shared by the open and resolved rows. */
function rowProblems(config, path, row, prefixes) {
  const at = `${path}:${row.line}`;
  const problems = [];
  if (!ID.test(row.id)) problems.push(`${at}: ${row.id || "a row"} is not an ID such as Q-012`);
  if (!row.question) problems.push(`${at}: ${row.id} has no question`);
  else if (words(row.question) > config.docs.cellWords) problems.push(`${at}: ${row.id} Question has ${words(row.question)} words, over ${config.docs.cellWords}; put the detail in a bullet under the table`);
  if (!isNeeds(config, row.needs)) problems.push(`${at}: ${row.id} Needs "${row.needs}", which is not one of ${config.roles.join(", ")}, or ${CLIENT}`);
  if (!isFrom(config, row.from)) problems.push(`${at}: ${row.id} From "${row.from}" is a role or "client (<channel>)"`);
  const storyCell = new RegExp(`^(none|(?:${prefixes.join("|") || "[A-Z]+"})-\\d{2}(?:, (?:${prefixes.join("|") || "[A-Z]+"})-\\d{2})*)$`);
  if (!storyCell.test(row.story)) problems.push(`${at}: ${row.id} Story is "none" or story IDs such as APP-01, comma-separated`);
  if (!DATE.test(row.raised)) problems.push(`${at}: ${row.id} Raised is a date, YYYY-MM-DD`);
  return problems;
}

/** doc:check's problems with the open and resolved questions. */
export function questionProblems({ config, files, tracked }) {
  const present = new Set(tracked);
  const { openQuestions: open, questionsResolved: resolved, looseQuestions } = config.logs;
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const problems = [];
  const seen = new Map();
  for (const [path, isOpen] of [[open, true], [resolved, false]]) {
    if (!present.has(path)) continue;
    const text = files(path);
    if (isOpen) {
      text.split("\n").forEach((line, index) => {
        if (TICKED.test(line)) problems.push(`${path}:${index + 1}: a ticked question stays here; move it with wf question resolve, and its answer to the decisions log`);
      });
    }
    if (looseQuestions.includes(path)) continue;
    const plain = text.replace(/^```[\s\S]*?^```$/gm, (block) => block.replace(/[^\n]/g, ""));
    const rows = questionRows(plain);
    const width = isOpen ? OPEN_COLUMNS.length : RESOLVED_COLUMNS.length;
    const header = isOpen ? OPEN_HEADER[0] : RESOLVED_HEADER[0];
    for (const line of plain.split("\n").map((each, index) => ({ each, index })).filter(({ each }) => /^\|\s*ID\s*\|/.test(each))) {
      if (line.each.trim() !== header) problems.push(`${path}:${line.index + 1}: the table header is ${header}`);
    }
    for (const row of rows) {
      if (row.width !== width) problems.push(`${path}:${row.line}: ${row.id} has ${row.width} cells, not ${width}`);
      problems.push(...rowProblems(config, path, row, prefixes));
      if (ID.test(row.id)) {
        if (seen.has(row.id)) problems.push(`${path}:${row.line}: ${row.id} is also at ${seen.get(row.id)}; give one the next free ID`);
        seen.set(row.id, `${path}:${row.line}`);
      }
      if (isOpen && !row.heading) problems.push(`${path}:${row.line}: ${row.id} is under no ## heading; put it under its chunk or "${UNTIED}"`);
      if (!isOpen) {
        if (!DATE.test(row.resolved)) problems.push(`${path}:${row.line}: ${row.id} Resolved is a date, YYYY-MM-DD`);
        else if (DATE.test(row.raised) && row.resolved < row.raised) problems.push(`${path}:${row.line}: ${row.id} is resolved before it was raised`);
        if (!/^(D-[A-Z]+-\d{3}(, D-[A-Z]+-\d{3})*|none: .+)$/.test(row.decision)) problems.push(`${path}:${row.line}: ${row.id} Decision cites decision IDs, such as D-APP-012, or says "none: <why>"`);
      }
    }
    for (const bullet of looseBullets(plain)) {
      problems.push(`${path}:${bullet.line}: a question is a row in its heading's table; a bullet under it starts "- **Q-NNN.**"`);
    }
    const ids = new Set(rows.map((row) => row.id));
    plain.split("\n").forEach((line, index) => {
      const detail = line.match(DETAIL)?.[1];
      if (detail && !ids.has(detail)) problems.push(`${path}:${index + 1}: a detail bullet for ${detail}, which has no row here`);
    });
  }
  return problems;
}

/** Open questions per `##` heading: its table rows, and any old-style bullets of a log not moved yet. */
export function questionCounts(text) {
  return [...String(text ?? "").matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)]
    .map((match) => ({ heading: match[1], count: questionRows(match[2]).length + looseBullets(match[2]).length }))
    .filter((group) => group.count > 0);
}

/** The open questions that block a chunk, each { id, role, question, heading }: rows under a chunk heading. */
export function blockingRows(text) {
  return questionRows(text)
    // A question the client answers waits on the board, not on the team, so it never holds a merge.
    .filter((row) => row.heading && row.heading !== UNTIED && row.needs && row.needs !== CLIENT)
    .map((row) => ({ id: row.id, role: row.needs, question: row.question, heading: row.heading }));
}

/** Each question's revisit trigger, by ID: the first `Revisit when:` in its detail bullet or the sub-bullets under it. */
export function revisitTriggers(text) {
  const triggers = new Map();
  let id = null;
  for (const line of String(text ?? "").split("\n")) {
    const detail = line.match(DETAIL)?.[1];
    if (detail) id = detail;
    else if (!/^\s+\S/.test(line)) id = null;
    const trigger = id && line.match(REVISIT)?.[1].trim();
    if (trigger && !triggers.has(id)) triggers.set(id, trigger);
  }
  return triggers;
}

/** The questions under the untied heading, each { id, role, question, revisit }, `revisit` null when it has no trigger. */
export function untiedRows(text) {
  const triggers = revisitTriggers(text);
  return questionRows(text)
    .filter((row) => row.heading === UNTIED)
    .map((row) => ({ id: row.id, role: row.needs, question: row.question, revisit: triggers.get(row.id) ?? null }));
}

/** The text with a detail bullet added at the end of a heading's section, after its table. */
function insertDetail(text, heading, bullet) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const [start, end] = sectionBounds(lines, heading);
  let last = end - 1;
  while (last >= start && lines[last].trim() === "") last -= 1;
  lines.splice(last + 1, 0, ...(lines[last].startsWith("|") ? ["", bullet] : [bullet]));
  return `${lines.join("\n")}\n`;
}

/** A new open questions log: its title, how to use it, and the empty untied heading. */
export function emptyOpen(rel) {
  return [
    "# Open questions",
    "",
    `Every question not settled yet, in one table under the chunk it blocks, or under "${UNTIED}". Do not treat one as a decision. Add one with \`wf question add\`. When the role in Needs answers, the answer goes in [decisions](${rel.decisions}/), and \`wf question resolve\` moves the row to [the resolved questions](${rel.resolved}) with the date.`,
    "",
    `## ${UNTIED}`,
    "",
    "None.",
    "",
  ].join("\n");
}

/** A new resolved questions log: its title, how to use it, and the header. */
export function emptyResolved(rel) {
  return [
    "# Resolved questions",
    "",
    `Questions from [open-questions.md](${rel.open}) that are settled, oldest first, with the date and the decision each led to. The decision itself is in [decisions](${rel.decisions}/).`,
    "",
    ...RESOLVED_HEADER,
    "",
  ].join("\n");
}

/** The lines of a heading's section, as [start, end): from the line after the heading to the next `## ` or the end. */
function sectionBounds(lines, heading) {
  const start = lines.findIndex((line) => line === `## ${heading}` || line.startsWith(`## ${heading}:`) || line.startsWith(`## ${heading} `));
  if (start === -1) return null;
  const next = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return [start + 1, next === -1 ? lines.length : next];
}

/** The text with a row added at the end of the heading's table, the heading or table made when missing. */
export function insertRow(text, heading, title, row) {
  const lines = text.replace(/\n+$/, "").split("\n");
  let bounds = sectionBounds(lines, heading);
  if (!bounds) {
    const untied = sectionBounds(lines, UNTIED);
    const at = untied ? untied[0] - 1 : lines.length;
    lines.splice(at, 0, `## ${title ? `${heading}: ${title}` : heading}`, "", "None.", "");
    bounds = sectionBounds(lines, heading);
  }
  const [start, end] = bounds;
  const none = lines.slice(start, end).findIndex((line) => line.trim() === "None.");
  if (none !== -1) {
    lines.splice(start + none, 1, ...OPEN_HEADER, row);
    return `${lines.join("\n")}\n`;
  }
  let last = -1;
  for (let i = start; i < end; i += 1) if (lines[i].startsWith("|")) last = i;
  if (last === -1) {
    let at = start;
    while (at < end && lines[at].trim() === "") at += 1;
    lines.splice(at, 0, ...OPEN_HEADER, row, "");
  } else lines.splice(last + 1, 0, row);
  return `${lines.join("\n")}\n`;
}

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/**
 * Add an open question; returns its ID. `chunk` is a chunk ID or "none". Throws on a cell the check would refuse.
 * `revisit`, for an untied question only, writes its `Revisit when:` detail bullet.
 */
export function addQuestion(root, config, { chunk, question, needs, from, story = "none", date, title = "", revisit = "" }) {
  // A chunk's question comes back at that chunk; only an untied one needs a trigger.
  if (revisit && chunk !== "none") throw new Error(`a revisit trigger is for an untied question; one under ${chunk} comes back at that chunk`);
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const heading = chunk === "none" ? UNTIED : chunk;
  const openPath = join(root, config.logs.openQuestions);
  const resolvedPath = join(root, config.logs.questionsResolved);
  const openText = read(openPath);
  if (!openText) throw new Error(`no ${config.logs.openQuestions}; wf init writes it`);
  const id = nextId([openText, read(resolvedPath)]);
  const row = { id, question: cell(question ?? ""), needs, from, story: story || "none", raised: date, line: 0 };
  const problems = rowProblems(config, "", row, prefixes).map((problem) => problem.replace(/^:0: /, ""));
  if (problems.length) throw new Error(problems.join("; "));
  let out = insertRow(openText, heading, title, `| ${row.id} | ${row.question} | ${row.needs} | ${row.from} | ${row.story} | ${row.raised} |`);
  const trigger = String(revisit).replace(/\s+/g, " ").trim();
  if (trigger) out = insertDetail(out, heading, `- **${id}.** Revisit when: ${trigger}`);
  writeFileSync(openPath, out);
  return id;
}

/** Move an answered question to the resolved log, with the date and the decision cell; drops its detail bullets. */
export function resolveQuestion(root, config, id, decision, date) {
  if (!/^(D-[A-Z]+-\d{3}(, D-[A-Z]+-\d{3})*|none: .+)$/.test(decision ?? "")) throw new Error('the decision is decision IDs, such as D-APP-012, or "none: <why>"');
  const openPath = join(root, config.logs.openQuestions);
  const resolvedPath = join(root, config.logs.questionsResolved);
  const text = read(openPath);
  const row = questionRows(text).find((each) => each.id === id);
  if (!row) throw new Error(`${id} is not in ${config.logs.openQuestions}`);
  const lines = text.split("\n");
  lines.splice(row.line - 1, 1);
  // Its detail bullet, and the sub-bullets under it, go with it.
  const detail = lines.findIndex((line) => line.startsWith(`- **${id}.**`));
  if (detail !== -1) {
    let end = detail + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
    lines.splice(detail, end - detail);
  }
  // A table left with only its header becomes "None." again.
  for (let i = lines.length - 2; i >= 0; i -= 1) {
    if (lines[i] === OPEN_HEADER[0] && lines[i + 1] === OPEN_HEADER[1] && !(lines[i + 2] ?? "").startsWith("|")) lines.splice(i, 2, "None.");
  }
  writeFileSync(openPath, lines.join("\n"));
  const resolved = read(resolvedPath) || emptyResolved({ open: "open-questions.md", decisions: "decisions" });
  if (!resolved.includes(RESOLVED_HEADER[0])) throw new Error(`${config.logs.questionsResolved} has no resolved table; move its old entries into one first`);
  const out = resolved.replace(/\n+$/, "").split("\n");
  let last = out.indexOf(RESOLVED_HEADER[1]);
  while (out[last + 1]?.startsWith("|")) last += 1;
  out.splice(last + 1, 0, `| ${row.id} | ${row.question} | ${row.needs} | ${row.from} | ${row.story} | ${row.raised} | ${date} | ${cell(decision)} |`);
  writeFileSync(resolvedPath, `${out.join("\n")}\n`);
  return row;
}

/** Story IDs from arguments, such as ["GM-01", "GM-02,GM-03"], as one cell: "GM-01, GM-02, GM-03", or "none". */
export const storyList = (args) => [...new Set(args.flatMap((arg) => arg.split(/[,\s]+/)).filter((id) => id && id !== "none"))].join(", ") || "none";

const QUESTION_USAGE = 'Usage: wf question add <chunk | none> "<question>" <needs role> "<from: role or client (<channel>)>" [story IDs] [--revisit "<when to ask again>"]   or   wf question resolve <Q-ID> "<D-IDs or none: why>"';

/** `wf question add ... | resolve ...`; prints what it did and returns the exit code. */
export function runQuestion(root, config, [sub, ...rest], today) {
  const flag = rest.indexOf("--revisit");
  const revisit = flag === -1 ? "" : rest[flag + 1] ?? "";
  const args = flag === -1 ? rest : rest.filter((_, i) => i !== flag && i !== flag + 1);
  if (sub === "add" && args.length >= 4 && (flag === -1 || revisit)) {
    const [chunk, question, needs, from, ...stories] = args;
    // Every story ID given is kept, whether as separate arguments or one comma list.
    const story = storyList(stories);
    const { buildOrder, done } = readBuildOrder(root, config);
    const row = chunk === "none" ? null : findChunk([buildOrder, done], chunk);
    console.log(addQuestion(root, config, { chunk, question, needs, from, story, date: today, title: row?.title ?? "", revisit }));
    return 0;
  }
  if (sub === "resolve" && args.length === 2) {
    const row = resolveQuestion(root, config, args[0], args[1], today);
    console.log(`${row.id} moved to ${config.logs.questionsResolved}`);
    return 0;
  }
  console.log(QUESTION_USAGE);
  return 2;
}
