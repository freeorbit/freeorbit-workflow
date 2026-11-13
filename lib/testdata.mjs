// `wf testdata`: the project's test-data steps, named in `testdata.commands`
// in its config, run with the rest of the arguments after them. The kit knows
// no generator; it only gives each project the same names for the same steps.
//
// It also holds what the kit itself knows about test data: the project kinds,
// the rule categories every project shares, and doc:check's checks of an
// area's test-data folder: the kinds named, each story's Risk line, and
// warnings for a file past one screen, a flow area past its size, and a
// category no list names.

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
  }
  return warnings;
}
