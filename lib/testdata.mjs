// `wf testdata`: the project's test-data steps, named in `testdata.commands`
// in its config, run with the rest of the arguments after them. The kit knows
// no generator; it only gives each project the same names for the same steps.
//
// It also holds what the kit itself knows about test data: the project kinds,
// the rule categories every project shares, and doc:check's checks of an
// area's test-data folder: the kinds named, each story's Risk line, and
// warnings for a file past one screen, a flow area past its size, a category
// no list names, an input class listed twice, a fixture no person reaches,
// and fixtures past their budget for a story, a flow area, or a rule.

import { spawnSync } from "node:child_process";

import { matcher } from "./config/config.mjs";
import { readStories } from "./docs/stories.mjs";
import { projectCommand } from "./process.mjs";

/** The command for one test-data step, or null when the project has none. */
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

/** Every category name a project's rules may use: the kit's, then its own. */
export const categoryNames = (config) => [...CATEGORIES, ...config.testdata.categories].map((category) => category.name);

/** An area's kind: its own, else the project's. */
export const areaKind = (config, area) => area.kind ?? config.kind;

/** Each area's test-data folder, `<docs>/test-data/`, for the areas that name a docs folder. */
const folders = (config) => config.areas.filter((area) => area.docs).map((area) => ({ area, dir: `${area.docs}/test-data/` }));

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
      const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((each) => each.trim());
      if (header === undefined) header = needs.every((name) => cells.includes(name)) ? cells : null;
      else if (header && !cells.every((each) => /^:?-+:?$/.test(each))) out.push({ line: index + 1, cells: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])) });
    });
  return out;
}

const ids = (cell, pattern) => [...String(cell).matchAll(pattern)].map((m) => m[0]);
const RULE_ID = /\bR-\d+\b/g;
const STORY_ID = /\b[A-Z]{1,6}-\d+\b/g;

/** The kinds a config names that the kit does not know, and each story's Risk line that says neither high nor low. */
export function testdataProblems({ config, tracked, files }) {
  const problems = [];
  if (!KINDS.includes(config.kind)) problems.push(`.workflow/config.json: kind "${config.kind}" is not one of ${KINDS.join(", ")}`);
  for (const area of config.areas) {
    if (area.kind !== undefined && !KINDS.includes(area.kind)) problems.push(`.workflow/config.json: area ${area.id} kind "${area.kind}" is not one of ${KINDS.join(", ")}`);
  }
  for (const category of config.testdata.categories) {
    if (!category?.name) problems.push(`.workflow/config.json: a testdata.categories entry has no name`);
  }
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFile = matcher(config.stories.files);
  for (const path of tracked.filter(storyFile)) {
    for (const story of readStories(files(path), prefixes, path)) {
      if (story.risk && !story.risk.level) problems.push(`${path}:${story.line}: ${story.id} Risk says "${story.risk.raw}"; write "Risk: high (<why>)", "Risk: low", or no line for low`);
    }
  }
  return problems;
}

/** doc:check's warnings about test data: never a failure, so its volume is a choice and not a drift. */
export function testdataWarnings({ config, tracked, files }) {
  const { lines: maxLines, areaKB, loose } = config.testdata.limits;
  const isLoose = matcher(loose);
  const names = new Set(categoryNames(config));
  const warnings = [];
  for (const { dir } of folders(config)) {
    for (const flow of flowAreas(dir, tracked)) {
      const bytes = flow.paths.reduce((sum, path) => sum + Buffer.byteLength(files(path)), 0);
      if (bytes > areaKB * 1024) warnings.push(`${flow.name}: ${Math.round(bytes / 1024)} KB, over ${areaKB}; split it by dataset group, or into a folder of one-screen files`);
    }
    for (const path of tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md"))) {
      const count = files(path).replace(/\n+$/, "").split("\n").length;
      if (count > maxLines && !isLoose(path)) warnings.push(`${path}: ${count} lines, over ${maxLines}, about one screen; move a topic into a file of its own`);
      const unknown = new Map();
      for (const { line, category } of categoryCells(files(path))) if (!names.has(category)) unknown.set(category, [...(unknown.get(category) ?? []), line]);
      for (const [category, lines] of unknown) warnings.push(`${path}:${lines[0]}: category "${category}" (${lines.length === 1 ? "1 rule" : `${lines.length} rules`}) is not the kit's or in testdata.categories`);
    }
    warnings.push(...volumeWarnings(config, dir, tracked, files));
  }
  return warnings;
}

/**
 * Warnings about how many cases an area's folder holds: an input class listed
 * twice, a fixture that reaches `unit` (an input class), and fixtures past
 * `testdata.limits.fixtures` for a story, a flow area, or a rule.
 */
function volumeWarnings(config, dir, tracked, files) {
  const budget = config.testdata.limits.fixtures ?? {};
  const out = [];
  const paths = tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md"));
  const classes = new Map();
  const byStory = new Map();
  const byRule = new Map();
  const checks = config.testdata.limits.checks ?? {};
  const checkText = new Map();
  const checkStory = new Map();
  for (const path of paths) {
    for (const { line, cells } of tableRows(files(path), ["Check", "Stories"])) {
      const text = cells.Check.replace(/\s+/g, " ").trim();
      const key = text.toLowerCase().replace(/[`*_.]/g, "");
      const seen = checkText.get(key) ?? { text, at: [] };
      seen.at.push(`${path}:${line}`);
      checkText.set(key, seen);
      for (const story of new Set(ids(cells.Stories, STORY_ID))) checkStory.set(story, [...(checkStory.get(story) ?? []), `${path}:${line}`]);
    }
    for (const { line, cells } of tableRows(files(path), ["Input", "Class"])) {
      const key = `${cells.Input.replace(/`/g, "")}\u0000${cells.Class.toLowerCase()}`;
      if (classes.has(key)) out.push(`${path}:${line}: input ${cells.Input} class "${cells.Class}" is listed already, at ${classes.get(key)}; list an input's classes once, and name them from other flows`);
      else classes.set(key, `${path}:${line}`);
    }
    for (const { line, cells } of tableRows(files(path), ["Fixture", "Varies"])) {
      if (/^`?unit`?\b/.test(cells.Reach ?? "")) out.push(`${path}:${line}: ${cells.Fixture} reaches unit, which no person can; make it a class of its input`);
      for (const story of new Set(ids(cells.Stories, STORY_ID))) byStory.set(story, [...(byStory.get(story) ?? []), `${path}:${line}`]);
      for (const rule of new Set(ids(cells.Rules, RULE_ID))) byRule.set(rule, [...(byRule.get(rule) ?? []), `${path}:${line}`]);
    }
  }
  for (const flow of flowAreas(dir, tracked)) {
    const n = flow.paths.reduce((sum, path) => sum + tableRows(files(path), ["Fixture", "Varies"]).length, 0);
    if (budget.area && n > budget.area) out.push(`${flow.name}: ${n} edge-case fixtures, over ${budget.area}; merge rows into one with axes, or move the cases that vary one input into its input classes`);
    const c = flow.paths.reduce((sum, path) => sum + tableRows(files(path), ["Check", "Stories"]).length, 0);
    if (checks.area && c > checks.area) out.push(`${flow.name}: ${c} checks, over ${checks.area}; keep what this flow shows that no rule says`);
  }
  // A check written in several files is a rule said again: it lives once, with one test across every state.
  for (const { text, at } of checkText.values()) {
    const where = new Set(at.map((each) => each.split(":")[0]));
    if (checks.repeated && where.size >= checks.repeated) out.push(`${at[0]}: the check "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}" is in ${where.size} files; make it a rule in core.md with one test across every state, and drop it from the flows`);
  }
  for (const [story, at] of [...checkStory].sort((a, b) => b[1].length - a[1].length)) if (checks.story && at.length > checks.story) out.push(`${at[0]}: story ${story} has ${at.length} checks, over ${checks.story}; keep what only it shows, and leave what a rule says to the rule`);
  const over = (map, limit, what, hint) => {
    for (const [id, at] of [...map].sort((a, b) => b[1].length - a[1].length)) if (limit && at.length > limit) out.push(`${at[0]}: ${what} ${id} has ${at.length} edge-case fixtures, over ${limit}; ${hint}`);
  };
  over(byStory, budget.story, "story", "keep the ones only its flow shows, and ask the reviewer about any kept past it");
  over(byRule, budget.rule, "rule", "most are likely classes of one input; list them as its input classes");
  return out;
}
