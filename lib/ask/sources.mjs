// The named sources a table block can show: logs the kit already keeps, read
// when the page is built. A spec names a source, never a path, so a page can
// show only what the kit chose to offer. A code block is the one block that
// names a path: a file of the project, read by codeFile below.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { isSecret } from "../../plugins/core/hooks/guard.mjs";
import { decisionFiles, rows as decisionRows } from "../logs/decisions.mjs";
import { questionRows } from "../logs/questions.mjs";

/**
 * A log's text, or null when it is missing or lies outside the project: a
 * path from the config is read only inside the work tree, through no link
 * that leads out, as the kit's scripts promise (SECURITY.md).
 */
const read = (root, rel) => {
  const file = resolve(root, String(rel ?? ""));
  const inside = (base, path) => { const r = relative(base, path); return r && !r.startsWith("..") && !isAbsolute(r); };
  if (!inside(resolve(root), file) || !existsSync(file)) return null;
  return inside(realpathSync(root), realpathSync(file)) ? readFileSync(file, "utf8") : null;
};
// Files a code block never shows, as they may hold secrets: the guard's one
// list (SECRET_GLOBS), and beside it the git folder, certificates, and
// anything in a secrets folder. Each part of the path is checked, as typed
// and as it really is, so a link inside the project does not reach them.
const SECRET_PART = (part) => /^\.git$/i.test(part) || /^secrets?(\..*)?$/i.test(part) || /\.crt$/i.test(part) || isSecret(part) || isSecret(part.toLowerCase());
const CODE_BYTES = 1024 * 1024;

/**
 * A project file's text for a code block, or throws why not: inside the
 * project, reached through no link that leads out, not one that may hold
 * secrets, at most 1 MB, and text.
 */
export function codeFile(root, rel) {
  const name = String(rel ?? "");
  const file = resolve(root, name);
  const inside = (base, path) => { const r = relative(base, path); return Boolean(r) && !r.startsWith("..") && !isAbsolute(r); };
  if (!name || !inside(resolve(root), file)) throw new Error(`${name || "a code block's file"} is outside the project; a code block shows a file in it`);
  const secret = (path) => path.split(sep).some(SECRET_PART);
  if (secret(relative(resolve(root), file))) throw new Error(`${name} may hold secrets, so a code block does not show it`);
  if (!existsSync(file)) throw new Error(`${name} does not exist`);
  const real = realpathSync(file);
  const realRoot = realpathSync(root);
  if (!inside(realRoot, real)) throw new Error(`${name} leads out of the project`);
  if (secret(relative(realRoot, real))) throw new Error(`${name} leads to a file that may hold secrets, so a code block does not show it`);
  const stat = statSync(real);
  if (!stat.isFile()) throw new Error(`${name} is not a file`);
  if (stat.size > CODE_BYTES) throw new Error(`${name} is over 1 MB; show it some other way`);
  const bytes = readFileSync(real);
  if (bytes.includes(0)) throw new Error(`${name} is not text`);
  return bytes.toString("utf8");
}

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

// A finding is open while it is proposed, accepted, or deferred, as the
// ledger's own script counts it (plugins/review/scripts/ledger.py, OPEN);
// a fixed one waits for review, and is not open.
const OPEN_FINDING = /^(proposed|accepted|deferred)$/i;

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
  const open = rows.filter((r) => OPEN_FINDING.test(r.status));
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
