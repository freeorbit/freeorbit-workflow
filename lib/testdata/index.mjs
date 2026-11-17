// `wf testdata`: the project's test-data steps, named in `testdata.commands`
// in its config, run with the rest of the arguments after them. The kit knows
// no generator; it only gives each project the same names for the same steps.
//
// It also holds what the kit itself knows about test data: the project kinds,
// the rule categories every project shares, and how an area's spec reads.
// doc:check's checks of an area's test-data folder are in checks.mjs.
//
// checks.mjs fails the kinds named, each story's Risk line,
// an ID defined twice or with another area's prefix, a table a blank line
// cuts from its header, and a rule or check cited but defined nowhere. It
// warns for a file past a page or too small, a flow area past its size, a
// category no list names, an input class listed twice, a fixture no person
// reaches, fixtures past their budget, too many high-risk acceptance lines,
// old IDs, a name two areas define, proposed rules waiting on the reviewer,
// and a rule two flow areas cite outside core.md.
//
// A story's acceptance lines are its checks, each by its ID, such as GM-07.3.
// A checks table, `| ID | Check | Stories | Rules | By |`, is from before
// v0.69.0: its rows are still read, so a test that cites one still names it,
// but nothing gates, budgets, or reviews them, and `wf testdata prune` takes
// out those no code cites.

import { spawnSync } from "node:child_process";

import { bare, cellsOf, isSeparator } from "../docs/table.mjs";
import { projectCommand } from "../process.mjs";

export const commandFor = (config, name, args) => projectCommand(config.testdata.commands, name, args);

/** Run a step; `refresh-close <area> <ids>` runs covered, then index. Returns the exit code. */
export function runTestdata(root, config, name, args) {
  const steps = name === "refresh-close" ? [["covered", args], ["index", args.slice(0, 1)]] : [[name, args]];
  for (const [step, stepArgs] of steps) {
    const command = commandFor(config, step, stepArgs);
    if (!command) {
      console.error(`testdata.commands has no ${step}; add it to .workflow/config.json`);
      return 2;
    }
    const { status } = spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" });
    if (status !== 0) return status ?? 1;
  }
  return 0;
}

/** The kinds a project or an area can be, as project-kinds.md describes them. */
export const KINDS = ["app", "domain-product", "data-pipeline", "integration", "catalog"];

/** The rule categories the kit ships. A project adds its own with testdata.categories. */
export const CATEGORIES = [
  { name: "Never sent or stored", use: "What must never leave the machine, reach a log, or be kept" },
  { name: "Money and limits", use: "Prices, spend, caps, quotas, and counts with a ceiling" },
  { name: "Time", use: "Fixed todays, dates, time zones, ages, and anything that would read the clock" },
  { name: "Input shape", use: "Formats, sizes, encodings, and malformed or huge input" },
  { name: "State", use: "What a step may change, in what order, and what survives a restart" },
  { name: "Trust", use: "Outside text, links, replies from other systems, and what is allowed to act on them" },
  { name: "Evidence and citations", use: "A judgement or extracted field and the passage it rests on" },
  { name: "Workspaces", use: "One client, tenant, or account never seeing another's data" },
];

/**
 * Who a rule is for, by its Type: `product` (how the app behaves), `safety`
 * (a privacy or safety promise), or `craft` (how test data and stand-ins are
 * built).
 */
export const TYPES = ["product", "safety", "craft"];
// Categories whose rules are about how test data is built, so their Type is craft.
export const CRAFT_CATEGORIES = new Set(["stand-ins", "data markers"]);

/**
 * A rule's Type: the one its row gives, else what its category says. A rule
 * about how test data is built is craft, and one about what is never sent or
 * stored is safety, so a spec written before Types needs no tagging pass.
 */
export function typeOf(type, category) {
  const given = bare(type).toLowerCase();
  if (given) return given;
  const c = bare(category).toLowerCase();
  if (CRAFT_CATEGORIES.has(c)) return "craft";
  return c === "never sent or stored" ? "safety" : "";
}

/**
 * The rows of an area's proof table, `| Line | By |`: an acceptance line that
 * no test of its own proves, with what does instead: `walk`, `walked
 * <chunk>`, a later chunk's id, or the ID of a rule whose one test covers the
 * line in every state. Each `{ id, by, path, line }`.
 */
export function proofRows(paths, files) {
  const out = [];
  for (const path of paths) for (const { line, cells } of tableRows(files(path), ["Line", "By"])) out.push({ id: bare(cells.Line), by: bare(cells.By), path, line });
  return out;
}

/** Whether a rule is the owner's to review: product, safety, or one with no Type. */
export function forOwner(row) {
  // A Type off the list is the owner's: a typo never hides a rule.
  if (row.kind === "rule") return !TYPES.includes(row.type) || row.type === "product" || row.type === "safety";
  return false;
}

// What a plain line must not hold: code in backticks, marker and canary tokens,
// and scenario or fixture names, kebab words of three or more parts. A date
// starts with a digit, so it is not one; nor is an everyday hyphenated word.
const EVERYDAY = new Set(["up-to-date", "out-of-date", "end-to-end", "day-to-day", "one-to-one", "step-by-step", "face-to-face", "side-by-side", "state-of-the-art", "word-for-word", "built-in-to"]);
export const isJargon = (text) => /`|CANARY|[A-Z]{3,}MARK-|\bTEST-/.test(text) || [...String(text).matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\b/g)].some((m) => !EVERYDAY.has(m[0]));

/** Every category name a project's rules may use: the kit's, then its own. */
export const categoryNames = (config) => [...CATEGORIES, ...config.testdata.categories].map((category) => category.name);

/** An area's kind: its own, else the project's. */
export const areaKind = (config, area) => area.kind ?? config.kind;

/** Each area's test-data folder, `<docs>/test-data/`, for the areas that name a docs folder. */
export const folders = (config) => config.areas.filter((area) => area.docs).map((area) => ({ area, dir: `${area.docs}/test-data/` }));

/**
 * The flow areas in one test-data folder: each top-level Markdown file but the
 * README, and each folder below it, with the Markdown paths it holds.
 */
export function flowAreas(dir, tracked) {
  const byName = new Map();
  for (const path of tracked) {
    if (!path.startsWith(dir) || !path.endsWith(".md")) continue;
    const rest = path.slice(dir.length);
    if (rest === "README.md") continue;
    const name = rest.includes("/") ? `${rest.split("/")[0]}/` : rest;
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return [...byName].map(([name, paths]) => ({ name: `${dir}${name}`, paths }));
}

/**
 * The Category cell of each row of each rules table, one whose header has a
 * Category column and a Rule column, as { line, category }. A gaps table may
 * name a topic instead, and a product's own Category column is not one.
 */
export function categoryCells(text) {
  const out = [];
  // undefined outside a table, -1 in a table that is not one, else the Category column.
  let column;
  String(text ?? "")
    .split("\n")
    .forEach((line, index) => {
      if (!line.startsWith("|")) {
        column = undefined;
        return;
      }
      const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((each) => each.trim());
      if (column === undefined) column = cells.some((each) => /^Rule\b/.test(each)) ? cells.indexOf("Category") : -1;
      else if (column >= 0 && cells[column] && !/^:?-+:?$/.test(cells[column])) out.push({ line: index + 1, category: cells[column] });
    });
  return out;
}

/**
 * The rows of each table whose header has every column `needs` names, as
 * `{ line, cells }` with cells by header. A tool finds a column by its header.
 */
export function tableRows(text, needs) {
  const out = [];
  let header;
  String(text ?? "")
    .split("\n")
    .forEach((line, index) => {
      if (!line.startsWith("|")) {
        header = undefined;
        return;
      }
      const cells = cellsOf(line);
      if (header === undefined) header = needs.every((name) => cells.includes(name)) ? cells : null;
      else if (header && !cells.every((each) => /^:?-+:?$/.test(each))) out.push({ line: index + 1, cells: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])) });
    });
  return out;
}

export { bare, cellsOf, isSeparator };

/** An area's test-data folder and its Markdown files, or an error naming the area. */
export function areaSpec(config, tracked, areaId) {
  const area = config.areas.find((each) => each.id === areaId && each.docs);
  if (!area) throw new Error(`no area ${areaId} with a docs folder in .workflow/config.json`);
  const dir = `${area.docs}/test-data/`;
  return { area, dir, paths: tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")) };
}

/**
 * The ids an area's spec defines, each `{ kind, id, path, line }`: rules,
 * checks (but those only the walk proves, when `walk` is false), gaps,
 * datasets, fixtures, inputs (once each), and states. A rule also carries
 * `stories`, `by`, and `accepted`, a check `stories` and `by`, and a gap
 * `gapKind` and its row's `text`. A rule row proposing an edit defines nothing.
 */
export function specIds(paths, files, { walk = true } = {}) {
  const out = [];
  const add = (kind, id, path, line, more = {}) => { if (id && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) out.push({ kind, id, path, line, ...more }); };
  for (const path of paths) {
    const text = files(path);
    // A proposed edit to an accepted rule (Accepted: edit) repeats its ID and defines nothing until it is accepted.
    for (const { line, cells } of tableRows(text, ["ID", "Category", "Rule"])) if (!/^edit$/i.test(bare(cells.Accepted))) add("rule", bare(cells.ID), path, line, { stories: cells.Stories ?? "", by: bare(cells.By), accepted: bare(cells.Accepted), category: bare(cells.Category), type: typeOf(cells.Type, cells.Category), text: cells.Rule ?? "" });
    for (const { line, cells } of tableRows(text, ["ID", "Check"])) if (walk || !/\bwalk\b/i.test(cells.By ?? "")) add("check", bare(cells.ID), path, line, { stories: cells.Stories ?? "", by: bare(cells.By), text: cells.Check ?? "" });
    for (const { line, cells } of tableRows(text, ["ID", "Kind", "Question"])) add("gap", bare(cells.ID), path, line, { gapKind: bare(cells.Kind).toLowerCase(), text: Object.values(cells).join(" | ") });
    // A row the owner dropped: listed so its ID is never reused, defining nothing.
    for (const { line, cells } of tableRows(text, ["ID", "What", "Why", "Dropped"])) add("dropped", bare(cells.ID), path, line, { why: cells.Why ?? "", date: bare(cells.Dropped) });
    for (const { line, cells } of tableRows(text, ["Fixture", "Varies"])) add("fixture", bare(cells.Fixture), path, line);
    for (const { line, cells } of tableRows(text, ["Input", "Class"])) add("input", bare(cells.Input), path, line);
    for (const { line, cells } of tableRows(text, ["State"])) add("state", bare(cells.State), path, line);
    String(text).split("\n").forEach((each, i) => {
      const dataset = each.match(/^###\s+(DS-[A-Z]+-\d+|D\d+)\b/);
      if (dataset) add("dataset", dataset[1], path, i + 1);
    });
  }
  const seen = new Set();
  return out.filter((each) => (each.kind === "input" && seen.has(`input:${each.id}`) ? false : (seen.add(`${each.kind}:${each.id}`), true)));
}
