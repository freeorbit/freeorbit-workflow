// The named sources a table block can show: logs the kit already keeps, read
// when the page is built. A spec names a source, never a path, so a page can
// show only what the kit chose to offer.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { decisionFiles, rows as decisionRows } from "../logs/decisions.mjs";
import { questionRows } from "../logs/questions.mjs";

const read = (root, rel) => {
  const file = join(root, rel);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const plain = (cell) => cell.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`([^`]*)`/g, "$1");

/** The open questions log: one row per open question. */
function openQuestions(root, config) {
  const text = read(root, config.logs.openQuestions);
  if (text == null) return { columns: COLUMNS.questions, rows: [], empty: `No ${config.logs.openQuestions} in this project.` };
  const rows = questionRows(text).map((r) => ({ id: r.id, question: r.question, needs: r.needs, from: r.from, story: r.story, raised: r.raised }));
  return { columns: COLUMNS.questions, rows, empty: rows.length ? "" : "No open questions." };
}

/** Every decisions file's rows, or one file's with `filter`. */
function decisions(root, config, block) {
  const files = decisionFiles(config).filter((f) => !block.filter || f.id === block.filter);
  const rows = files.flatMap((f) => decisionRows(read(root, f.path) ?? "").map((r) => ({ id: r.id, decision: r.decision, why: r.why, date: r.date, status: r.status })));
  return { columns: COLUMNS.decisions, rows, empty: rows.length ? "" : block.filter ? `No decisions in ${block.filter}.` : "No decisions yet." };
}

/** The review ledger's open findings, from its Summary tables. */
function ledger(root, config) {
  const text = read(root, config.logs.ledger);
  if (text == null) return { columns: COLUMNS.ledger, rows: [], empty: `No ${config.logs.ledger} in this project.` };
  const summary = text.split(/^## Open\b/m)[0];
  const rows = [];
  for (const line of summary.split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    if (c[0] === "ID" || /^:?-+:?$/.test(c[0]) || c.length < 4) continue;
    rows.push({ id: plain(c[0]), severity: c[1], status: c[2], title: c[3], where: plain(c[4] ?? "") });
  }
  const open = rows.filter((r) => !/^(verified|rejected|closed)$/i.test(r.status));
  return { columns: COLUMNS.ledger, rows: open, empty: open.length ? "" : "No open findings." };
}

const COLUMNS = {
  questions: [{ key: "id", label: "ID" }, { key: "question", label: "Question" }, { key: "needs", label: "Needs" }, { key: "from", label: "From" }, { key: "story", label: "Story" }, { key: "raised", label: "Raised" }],
  decisions: [{ key: "id", label: "ID" }, { key: "decision", label: "Decision" }, { key: "why", label: "Why" }, { key: "date", label: "Date" }, { key: "status", label: "Status" }],
  ledger: [{ key: "id", label: "ID" }, { key: "severity", label: "Severity" }, { key: "status", label: "Status" }, { key: "title", label: "Title" }, { key: "where", label: "Where" }],
};

export const SOURCES = { "open-questions": openQuestions, decisions, ledger };

/** A source for blocks: `(name, block) => { columns, rows, empty }`, or null for a name the kit has none of. */
export function sourcesFor(root, config) {
  return (name, block) => (Object.hasOwn(SOURCES, name) ? SOURCES[name](root, config, block ?? {}) : null);
}
