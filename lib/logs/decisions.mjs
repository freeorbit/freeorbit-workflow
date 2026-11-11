// The decisions log: one file per area and per project-wide topic, under
// logs.decisions, each a short table, newest on top:
//
//   | ID | Date | Decision | Why | Status |
//   | D-GM-034 | 2026-11-06 | One sentence. | One sentence. | active |
//
// An ID is D-<prefix>-NNN, the area's story prefix or the topic's own, and is
// never reused. A superseded row moves, with its status, to the same-named
// file under logs.decisionsClosed. Docs cite a decision by its ID, which
// `wf doc:find D-GM-034` finds. `wf decision add` assigns the next ID and
// checks the length, and doc:check holds the rest.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cell, words } from "../docs/table.mjs";

export const HEADER = ["| ID | Date | Decision | Why | Status |", "| --- | --- | --- | --- | --- |"];
const ROW = /^\| (D-[A-Z]+-\d{3}) \| (\d{4}-\d{2}-\d{2}) \| (.*) \| (.*) \| ([^|]*) \|$/;
export const ID = /\bD-([A-Z]+)-(\d{3})\b/g;

/** Every decisions file: one per area with a prefix, then one per topic. */
export function decisionFiles(config) {
  const one = (id, prefix, title) => ({
    id,
    prefix,
    title,
    path: `${config.logs.decisions}/${id}.md`,
    closed: `${config.logs.decisionsClosed}/${id}.md`,
  });
  return [
    ...config.areas.filter((area) => area.prefix).map((area) => one(area.id, area.prefix, area.id)),
    ...config.decisionTopics.map((topic) => one(topic.id, topic.prefix, topic.id)),
  ];
}

/** The rows of a decisions file, as { id, date, decision, why, status, line }. */
export function rows(text) {
  return String(text ?? "")
    .split("\n")
    .map((line, index) => {
      const match = line.match(ROW);
      return match ? { id: match[1], date: match[2], decision: match[3], why: match[4], status: match[5].trim(), line: index + 1 } : null;
    })
    .filter(Boolean);
}


/** A new file's text: its title, a line on how to use it, and the header. */
export function emptyFile(file, closed = false) {
  const intro = closed
    ? `Decisions in ${file.title} that a later one replaced, with what replaced them. Cite one by its ID.`
    : `Decisions in ${file.title} that are in force, newest on top. Cite one by its ID, and find it with \`wf doc:find <ID>\`. Add one with \`wf decision add ${file.id}\`.`;
  return [`# ${file.title} decisions${closed ? ", closed" : ""}`, "", intro, "", ...HEADER, ""].join("\n");
}

/** The text with a row inserted at the top of its table. */
export function insertTop(text, row) {
  const lines = text.split("\n");
  const at = lines.indexOf(HEADER[1]);
  if (at === -1) throw new Error("the file has no decisions table header");
  lines.splice(at + 1, 0, row);
  return lines.join("\n");
}

/** The next free number for a file, past every ID in it and its closed file. */
export function nextId(file, texts) {
  const numbers = texts.flatMap((text) => rows(text).map((row) => Number(row.id.split("-")[2])));
  return `D-${file.prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

/** Add a decision to a file; returns its ID. Throws when a cell is too long. */
export function addDecision(root, config, fileId, decision, why, date) {
  const file = decisionFiles(config).find((each) => each.id === fileId);
  if (!file) throw new Error(`no decisions file ${fileId}; one of ${decisionFiles(config).map((each) => each.id).join(", ")}`);
  const limit = config.docs.cellWords;
  for (const [name, text] of [["decision", decision], ["why", why]]) {
    if (!text?.trim()) throw new Error(`the ${name} is empty`);
    if (words(text) > limit) throw new Error(`the ${name} has ${words(text)} words; keep it to ${limit} and put the detail in the doc that owns it`);
  }
  const path = join(root, file.path);
  const closedPath = join(root, file.closed);
  const text = existsSync(path) ? readFileSync(path, "utf8") : emptyFile(file);
  const id = nextId(file, [text, existsSync(closedPath) ? readFileSync(closedPath, "utf8") : ""]);
  mkdirSync(join(root, config.logs.decisions), { recursive: true });
  writeFileSync(path, insertTop(text, `| ${id} | ${date} | ${cell(decision)} | ${cell(why)} | active |`));
  return id;
}

/** Move a decision to its closed file, marked superseded by another. */
export function supersede(root, config, id, by) {
  const file = decisionFiles(config).find((each) => id.startsWith(`D-${each.prefix}-`));
  if (!file) throw new Error(`${id} has no decisions file`);
  const path = join(root, file.path);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const row = rows(text).find((each) => each.id === id);
  if (!row) throw new Error(`${id} is not in ${file.path}`);
  const lines = text.split("\n");
  lines.splice(row.line - 1, 1);
  writeFileSync(path, lines.join("\n"));
  const closedPath = join(root, file.closed);
  mkdirSync(join(root, config.logs.decisionsClosed), { recursive: true });
  const closed = existsSync(closedPath) ? readFileSync(closedPath, "utf8") : emptyFile(file, true);
  writeFileSync(closedPath, insertTop(closed, `| ${row.id} | ${row.date} | ${row.decision} | ${row.why} | superseded by ${by} |`));
}

/** doc:check's problems with the decisions and the docs that cite them. */
export function decisionProblems({ config, files, tracked }, history) {
  const present = new Set(tracked);
  const problems = [];
  const defined = new Map();
  const prefixes = new Set();
  for (const file of decisionFiles(config)) {
    prefixes.add(file.prefix);
    for (const [path, closed] of [[file.path, false], [file.closed, true]]) {
      if (!present.has(path)) continue;
      const found = rows(files(path));
      let last = null;
      for (const row of found) {
        if (!row.id.startsWith(`D-${file.prefix}-`)) problems.push(`${path}:${row.line}: ${row.id} does not belong in ${file.id}, whose IDs are D-${file.prefix}-NNN`);
        if (defined.has(row.id)) problems.push(`${path}:${row.line}: ${row.id} is also at ${defined.get(row.id)}; give one the next free ID`);
        defined.set(row.id, `${path}:${row.line}`);
        if (last && (row.date > last.date || (row.date === last.date && row.id > last.id))) problems.push(`${path}:${row.line}: ${row.id} is newer than the row above it; newest goes on top`);
        if (closed && !/^(superseded by|moved to) D-[A-Z]+-\d{3}$|^reversed\b/.test(row.status)) problems.push(`${path}:${row.line}: a closed row's status is "superseded by <ID>", "moved to <ID>", or "reversed"`);
        if (!closed && row.status !== "active") problems.push(`${path}:${row.line}: ${row.id} is ${row.status}; move it with wf decision supersede`);
        if (!config.docs.longDecisions.includes(file.id)) {
          for (const [name, text] of [["Decision", row.decision], ["Why", row.why]]) {
            if (words(text) > config.docs.cellWords) problems.push(`${path}:${row.line}: ${row.id} ${name} has ${words(text)} words, over ${config.docs.cellWords}`);
          }
        }
        last = row;
      }
    }
  }
  const cites = tracked.filter((path) => path.endsWith(".md") && !history(path) && !path.startsWith(`${config.logs.decisions}/`));
  for (const path of cites) {
    const text = files(path);
    for (const match of text.matchAll(ID)) {
      if (prefixes.has(match[1]) && !defined.has(match[0])) problems.push(`${path}: no decision ${match[0]}`);
    }
    if (/\bdecided \d{4}-\d{2}-\d{2}\b/.test(text)) problems.push(`${path}: cites a decision by its date; cite its ID, such as D-WF-012`);
  }
  return problems;
}
